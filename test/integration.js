// Native
import { basename, join } from 'node:path';
import { Server } from 'node:http';

// Packages
import test from 'ava';
import { listen } from 'async-listen';
import { serve } from 'micro';
import fetch from 'node-fetch';
import fs from 'node:fs';
import fsExtra from 'fs-extra';
import sleep from 'sleep-promise';

// Utilities
import handler from '../src/index.js';
import { errorTemplate } from '../src/error-template.js';

const fixturesTarget = 'test/fixtures';
const fixturesFull = join(process.cwd(), fixturesTarget);

const getUrl = async (customConfig, handlers) => {
	const config = Object.assign({
		'public': fixturesTarget
	}, customConfig);

	const server = new Server(serve(async (request, response) => {
		await handler(request, response, config, handlers);
	}));

	const url = await listen(server);

	return { url, server };
};

const getDirectoryContents = async (location = fixturesFull, sub, exclude = []) => {
	const excluded = [
		'.DS_Store',
		'.git',
		...exclude
	];

	const content = await fs.promises.readdir(location);

	if (sub) {
		content.unshift('..');
	}

	return content.filter(item => !excluded.includes(item));
};

test('render html directory listing', async t => {
	const contents = await getDirectoryContents();

	const { url, server } = await getUrl();
	const response = await fetch(url);
	const text = await response.text();
	server.close();

	const type = response.headers.get('content-type');

	t.is(type, 'text/html; charset=utf-8');
	t.true(contents.every(item => text.includes(item)));
});

test('render json directory listing', async t => {
	const contents = await getDirectoryContents();
	const { server, url } = await getUrl();

	const response = await fetch(url, {
		headers: {
			Accept: 'application/json'
		}
	});
	server.close();

	const type = response.headers.get('content-type');
	t.is(type, 'application/json; charset=utf-8');

	const {files} = await response.json();

	const existing = files.every(file => {
		const full = file.base.replace('/', '');
		return contents.includes(full);
	});

	t.true(existing);
});

test('render html sub directory listing', async t => {
	const name = 'special-directory';

	const sub = join(fixturesFull, name);
	const contents = await getDirectoryContents(sub, true);
	const { server, url } = await getUrl();
	const response = await fetch(`${url}/${name}`);
	server.close();
	const text = await response.text();

	const type = response.headers.get('content-type');
	t.is(type, 'text/html; charset=utf-8');

	t.true(contents.every(item => text.includes(item)));
});

test('render json sub directory listing', async t => {
	const name = 'special-directory';

	const sub = join(fixturesFull, name);
	const contents = await getDirectoryContents(sub, true);
	const { server, url } = await getUrl();

	const response = await fetch(`${url}/${name}`, {
		headers: {
			Accept: 'application/json'
		}
	});
	server.close();

	const type = response.headers.get('content-type');
	t.is(type, 'application/json; charset=utf-8');

	const {files} = await response.json();

	const existing = files.every(file => {
		const full = file.base.replace('/', '');
		return contents.includes(full);
	});

	t.true(existing);
});

test('render json sub directory listing with custom stat handler', async t => {
	const name = 'special-directory';

	const sub = join(fixturesFull, name);
	const contents = await getDirectoryContents(sub, true);

	// eslint-disable-next-line no-undefined
	const { server, url } = await getUrl(undefined, {
		lstat: (location, isDirectoryListing) => {
			if (contents.includes(basename(location))) {
				t.true(isDirectoryListing);
			} else {
				t.falsy(isDirectoryListing);
			}

			return fs.promises.lstat(location);
		}
	});

	const response = await fetch(`${url}/${name}`, {
		headers: {
			Accept: 'application/json'
		}
	});
	server.close();

	const type = response.headers.get('content-type');
	t.is(type, 'application/json; charset=utf-8');

	const {files} = await response.json();

	const existing = files.every(file => {
		const full = file.base.replace('/', '');
		return contents.includes(full);
	});

	t.true(existing);
});

test('render dotfile', async t => {
	const name = '.dotfile';
	const related = join(fixturesFull, name);

	const content = await fs.promises.readFile(related, 'utf8');
	const { server, url } = await getUrl();
	const response = await fetch(`${url}/${name}`);
	server.close()
	const text = await response.text();

	t.deepEqual(content, text);
});

test('render json file', async t => {
	const name = 'object.json';
	const related = join(fixturesFull, name);

	const content = await fs.promises.readFile(related, 'utf8');
	const { server, url } = await getUrl();
	const response = await fetch(`${url}/${name}`);
	server.close();

	const type = response.headers.get('content-type');
	t.is(type, 'application/json; charset=utf-8');

	const text = await response.text();

	t.deepEqual(text, content);
});

test('try to render non-existing json file', async t => {
	const name = 'mask-off.json';
	const { server, url } = await getUrl();
	const response = await fetch(`${url}/${name}`);
	server.close();

	const type = response.headers.get('content-type');

	t.is(type, 'text/html; charset=utf-8');
	t.is(response.status, 404);
});

test('try to render non-existing json file and `stat` errors', async t => {
	const name = 'mask-off.json';
	const message = 'I am an error';

	let done = null;

	// eslint-disable-next-line no-undefined
	const { server, url } = await getUrl(undefined, {
		lstat: location => {
			if (basename(location) === name && !done) {
				done = true;
				throw new Error(message);
			}

			return fs.promises.lstat(location);
		}
	});

	const response = await fetch(`${url}/${name}`);
	server.close();
	const text = await response.text();

	t.is(response.status, 500);

	const content = errorTemplate({
		statusCode: 500,
		message: 'A server error has occurred'
	});

	t.is(text, content);
});

test('set `trailingSlash` config property to `true`', async t => {
	const { server, url } = await getUrl({
		trailingSlash: true
	});

	const target = `/test`;

	const response = await fetch(`${url}${target}`, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');
	t.is(location, `${target}/`);
});

test('set `trailingSlash` config property to any boolean and remove multiple slashes', async t => {
	const { server, url } = await getUrl({
		trailingSlash: true
	});

	const target = `/test/`;

	const response = await fetch(`${url}${target}//////`, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');
	t.is(location, target);
});

test('set `trailingSlash` config property to `false`', async t => {
	const { server, url } = await getUrl({
		trailingSlash: false
	});

	const target = `/test`;

	const response = await fetch(`${url}${target}/`, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');
	t.is(location, target);
});

test('set `cleanUrls` config property should prevent open redirects', async t => {
	const { server, url } = await getUrl({
		cleanUrls: true
	});

	const response = await fetch(`${url}//haveibeenpwned.com/index`, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');
	t.is(location, `/haveibeenpwned.com`);
});

test('set `rewrites` config property to wildcard path', async t => {
	const destination = '.dotfile';
	const related = join(fixturesFull, destination);
	const content = await fs.promises.readFile(related, 'utf8');

	const { server, url } = await getUrl({
		rewrites: [{
			source: 'face/**',
			destination
		}]
	});

	const response = await fetch(`${url}/face/delete`);
	server.close();
	const text = await response.text();

	t.is(text, content);
});

test('set `rewrites` config property to non-matching path', async t => {
	const destination = '404.html';
	const related = join(fixturesFull, destination);
	const content = await fs.promises.readFile(related, 'utf8');

	const { server, url } = await getUrl({
		rewrites: [{
			source: 'face/**',
			destination
		}]
	});

	const response = await fetch(`${url}/mask/delete`);
	server.close();
	const text = await response.text();

	t.is(text, content);
});

test('set `rewrites` config property to one-star wildcard path', async t => {
	const destination = '.dotfile';
	const related = join(fixturesFull, destination);
	const content = await fs.promises.readFile(related, 'utf8');

	const { server, url } = await getUrl({
		rewrites: [{
			source: 'face/*/mask',
			destination
		}]
	});

	const response = await fetch(`${url}/face/delete/mask`);
	server.close();
	const text = await response.text();

	t.is(text, content);
});

test('set `rewrites` config property to path segment', async t => {
	const related = join(fixturesFull, 'object.json');
	const content = await fsExtra.readJSON(related);

	const { server, url } = await getUrl({
		rewrites: [{
			source: 'face/:id',
			destination: ':id.json'
		}]
	});

	const response = await fetch(`${url}/face/object`);
	server.close();
	const json = await response.json();

	t.deepEqual(json, content);
});

test('set `redirects` config property to wildcard path', async t => {
	const destination = 'testing';

	const { server, url } = await getUrl({
		redirects: [{
			source: 'face/**',
			destination
		}]
	 });

	const response = await fetch(`${url}/face/mask`, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');
	t.is(location, `/${destination}`);
});

test('set `redirects` config property to a negated wildcard path', async t => {
	const destination = 'testing';

	const { server, url } = await getUrl({
		redirects: [{
			source: '!face/**',
			destination
		}]
	 });

	const responseTruthy = await fetch(`${url}/test/mask`, {
		redirect: 'manual',
		follow: 0
	});

	const locationTruthy = responseTruthy.headers.get('location');
	t.is(locationTruthy, `/${destination}`);

	const responseFalsy = await fetch(`${url}/face/mask`, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const locationFalsy = responseFalsy.headers.get('location');
	t.falsy(locationFalsy);
});

test('set `redirects` config property to wildcard path and do not match', async t => {
	const destination = 'testing';

	const { server, url } = await getUrl({
		redirects: [{
			source: 'face/**',
			destination
		}]
	 });

	const response = await fetch(`${url}/test/mask`, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');
	t.falsy(location);
});

test('set `redirects` config property to one-star wildcard path', async t => {
	const destination = 'testing';

	const { server, url } = await getUrl({
		redirects: [{
			source: 'face/*/ideal',
			destination
		}]
	 });

	const response = await fetch(`${url}/face/mask/ideal`, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');
	t.is(location, `/${destination}`);
});

test('set `redirects` config property to extglob wildcard path', async t => {
	const destination = 'testing';

	const { server, url } = await getUrl({
		redirects: [{
			source: 'face/+(mask1|mask2)/ideal',
			destination
		}]
	 });

	const response = await fetch(`${url}/face/mask1/ideal`, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');

	t.is(location, `/${destination}`);
});

test('set `redirects` config property to path segment', async t => {
	const { server, url } = await getUrl({
		redirects: [{
			source: 'face/:segment',
			destination: 'mask/:segment'
		}]
	 });

	const response = await fetch(`${url}/face/me`, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');
	t.is(location, `/mask/me`);
});

test('set `redirects` config property to wildcard path and `trailingSlash` to `true`', async t => {
	const target = '/face/mask';

	const { server, url } = await getUrl({
		trailingSlash: true,
		redirects: [{
			source: 'face/**',
			destination: 'testing'
		}]
	 });

	const response = await fetch(url + target, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');
	t.is(location, `${target}/`);
});

test('set `redirects` config property to wildcard path and `trailingSlash` to `false`', async t => {
	const target = '/face/mask';

	const { server, url } = await getUrl({
		trailingSlash: false,
		redirects: [{
			source: 'face/**',
			destination: 'testing'
		}]
	 });

	const response = await fetch(`${url + target}/`, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');
	t.is(location, target);
});

test('pass custom handlers', async t => {
	const name = '.dotfile';

	// eslint-disable-next-line no-undefined
	const { server, url } = await getUrl(undefined, {
		lstat: fs.promises.lstat,
		createReadStream: fs.createReadStream
	});

	const response = await fetch(`${url}/${name}`);
	server.close();
	const text = await response.text();
	const content = await fs.promises.readFile(join(fixturesFull, name), 'utf8');

	t.is(text, content);
});

test('set `headers` to wildcard headers', async t => {
	const key = 'Cache-Control';
	const value = 'max-age=7200';

	const list = [{
		source: '*.md',
		headers: [{
			key,
			value
		}]
	}];

	const { server, url } = await getUrl({
		headers: list
	});

	const response = await fetch(`${url}/docs.md`);
	server.close();
	const cacheControl = response.headers.get(key);

	t.is(cacheControl, value);
});

test('set `headers` to fixed headers and check default headers', async t => {
	const key = 'Cache-Control';
	const value = 'max-age=7200';

	const list = [{
		source: 'object.json',
		headers: [{
			key,
			value
		}]
	}];

	const { server, url } = await getUrl({
		headers: list
	});

	const {headers} = await fetch(`${url}/object.json`);
	server.close();
	const cacheControl = headers.get(key);
	const type = headers.get('content-type');

	t.is(cacheControl, value);
	t.is(type, 'application/json; charset=utf-8');
});

test('receive not found error', async t => {
	const { server, url } = await getUrl({
		'public': join(fixturesFull, 'directory')
	});

	const response = await fetch(`${url}/not-existing`);
	server.close();
	const text = await response.text();

	const content = errorTemplate({
		statusCode: 404,
		message: 'The requested path could not be found'
	});

	t.is(text, content);
});

test('receive not found error as json', async t => {
	const { server, url } = await getUrl();

	const response = await fetch(`${url}/not-existing`, {
		headers: {
			Accept: 'application/json'
		}
	});
	server.close();

	const json = await response.json();

	t.deepEqual(json, {
		error: {
			code: 'not_found',
			message: 'The requested path could not be found'
		}
	});
});

test('receive custom `404.html` error page', async t => {
	const { server, url } = await getUrl();
	const response = await fetch(`${url}/not-existing`);
	server.close();
	const text = await response.text();

	t.is(text.trim(), '<span>Not Found</span>');
});

test('error is still sent back even if reading `404.html` failed', async t => {
	// eslint-disable-next-line no-undefined
	const { server, url } = await getUrl(undefined, {
		console: {
			error: () => {}
		},
		lstat: location => {
			if (basename(location) === '404.html') {
				throw new Error('Any error occured while checking the file');
			}

			return fs.promises.lstat(location);
		}
	});

	const response = await fetch(`${url}/not-existing`);
	server.close();
	const text = await response.text();

	t.is(response.status, 404);

	const content = errorTemplate({
		statusCode: 404,
		message: 'The requested path could not be found'
	});

	t.is(text, content);
});

test('disabled directory listing', async t => {
	const { server, url } = await getUrl({
		directoryListing: false
	});

	const response = await fetch(url);
	server.close();
	const text = await response.text();

	t.is(response.status, 404);
	t.is(text.trim(), '<span>Not Found</span>');
});

test('listing the directory failed', async t => {
	const message = 'Internal Server Error';

	// eslint-disable-next-line no-undefined
	const { server, url } = await getUrl(undefined, {
		readdir: () => {
			throw new Error(message);
		}
	});

	const response = await fetch(url);
	server.close();
	const text = await response.text();

	t.is(response.status, 500);

	const content = errorTemplate({
		statusCode: 500,
		message: 'A server error has occurred'
	});

	t.is(text, content);
});

test('set `cleanUrls` config property to `true`', async t => {
	const target = 'directory';
	const index = join(fixturesFull, target, 'index.html');

	const { server, url } = await getUrl({
		cleanUrls: true
	});

	const response = await fetch(`${url}/${target}`);
	server.close();
	const content = await fs.promises.readFile(index, 'utf8');
	const text = await response.text();

	t.is(content, text);
});

test('set `cleanUrls` config property to array', async t => {
	const target = 'directory';
	const index = join(fixturesFull, target, 'index.html');

	const { server, url } = await getUrl({
		cleanUrls: [
			'/directory**'
		]
	});

	const response = await fetch(`${url}/${target}`);
	server.close();
	const content = await fs.promises.readFile(index, 'utf8');
	const text = await response.text();

	t.is(content, text);
});

test('set `cleanUrls` config property to empty array', async t => {
	const name = 'directory';

	const sub = join(fixturesFull, name);
	const contents = await getDirectoryContents(sub, true);

	const { server, url } = await getUrl({
		cleanUrls: []
	});

	const response = await fetch(`${url}/${name}`);
	server.close();
	const text = await response.text();

	const type = response.headers.get('content-type');
	t.is(type, 'text/html; charset=utf-8');

	t.true(contents.every(item => text.includes(item)));
});

test('set `cleanUrls` config property to `true` and try with file', async t => {
	const target = '/directory/clean-file';

	const { server, url } = await getUrl({
		cleanUrls: true
	});

	const response = await fetch(`${url}${target}.html`, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');
	t.is(location, `${target}`);
});

test('set `cleanUrls` config property to `true` and not index file found', async t => {
	const contents = await getDirectoryContents();
	const { server, url } = await getUrl({cleanUrls: true});

	const response = await fetch(url, {
		headers: {
			Accept: 'application/json'
		}
	});
	server.close();

	const type = response.headers.get('content-type');
	t.is(type, 'application/json; charset=utf-8');

	const {files} = await response.json();

	const existing = files.every(file => {
		const full = file.base.replace('/', '');
		return contents.includes(full);
	});

	t.true(existing);
});

test('set `cleanUrls` config property to `true` and an error occurs', async t => {
	const target = 'directory';
	const message = 'Internal Server Error';

	const { server, url } = await getUrl({
		cleanUrls: true
	}, {
		lstat: location => {
			if (basename(location) === 'index.html') {
				throw new Error(message);
			}

			return fs.promises.lstat(location);
		}
	});

	const response = await fetch(`${url}/${target}`);
	server.close();
	const text = await response.text();

	t.is(response.status, 500);

	const content = errorTemplate({
		statusCode: 500,
		message: 'A server error has occurred'
	});

	t.is(text, content);
});

test('error occurs while getting stat of path', async t => {
	const message = 'Internal Server Error';

	// eslint-disable-next-line no-undefined
	const { server, url } = await getUrl(undefined, {
		lstat: location => {
			if (basename(location) !== '500.html') {
				throw new Error(message);
			}
		}
	});

	const response = await fetch(url);
	server.close();
	const text = await response.text();

	const content = errorTemplate({
		statusCode: 500,
		message: 'A server error has occurred'
	});

	t.is(response.status, 500);
	t.is(text, content);
});

test('the first `lstat` call should be for a related file', async t => {
	let done = null;

	// eslint-disable-next-line no-undefined
	const { server, url } = await getUrl(undefined, {
		lstat: location => {
			if (!done) {
				t.is(basename(location), 'index.html');
				done = true;
			}

			return fs.promises.lstat(location);
		}
	});

	await fetch(url);
	server.close();
});

test('the `lstat` call should only be made for files and directories', async t => {
	const locations = [];

	// eslint-disable-next-line no-undefined
	const { server, url } = await getUrl(undefined, {
		lstat: location => {
			locations.push(location);
			return fs.promises.lstat(location);
		}
	});

	await fetch(url);
	server.close();

	t.falsy(locations.some(location => basename(location) === '.html'));
});

test('error occurs while getting stat of not-found path', async t => {
	const message = 'Internal Server Error';
	const base = 'not-existing';

	// eslint-disable-next-line no-undefined
	const { server, url } = await getUrl(undefined, {
		lstat: location => {
			if (basename(location) === base) {
				throw new Error(message);
			}

			return fs.promises.lstat(location);
		}
	});

	const response = await fetch(`${url}/${base}`);
	server.close();
	const text = await response.text();

	t.is(response.status, 500);

	const content = errorTemplate({
		statusCode: 500,
		message: 'A server error has occurred'
	});

	t.is(text, content);
});

test('set `unlisted` config property to array', async t => {
	const unlisted = [
		'directory'
	];

	const contents = await getDirectoryContents(fixturesFull, null, unlisted);
	const { server, url } = await getUrl({unlisted});

	const response = await fetch(url, {
		headers: {
			Accept: 'application/json'
		}
	});
	server.close();

	const type = response.headers.get('content-type');
	t.is(type, 'application/json; charset=utf-8');

	const {files} = await response.json();

	const existing = files.every(file => {
		const full = file.base.replace('/', '');
		return contents.includes(full);
	});

	t.true(existing);
});

test('set `createReadStream` handler to async function', async t => {
	const name = '.dotfile';
	const related = join(fixturesFull, name);
	const content = await fs.promises.readFile(related, 'utf8');

	// eslint-disable-next-line no-undefined
	const { server, url } = await getUrl(undefined, {
		createReadStream: async (file, opts) => {
			await sleep(1000);
			return fs.createReadStream(file, opts);
		}
	});

	const response = await fetch(`${url}/${name}`);
	server.close();
	const text = await response.text();

	t.deepEqual(content, text);
});

test('return mime type of the `rewrittenPath` if mime type of `relativePath` is null', async t => {
	const { server, url } = await getUrl({
		rewrites: [{
			source: '**',
			destination: 'clean-file.html'
		}]
	});

	const response = await fetch(`${url}/whatever`);
	server.close();
	const type = response.headers.get('content-type');

	t.is(type, 'text/html; charset=utf-8');
});

test('error if trying to traverse path', async t => {
	const { server, url } = await getUrl();
	const response = await fetch(`${url}/../../test`);
	server.close();
	const text = await response.text();

    // This previously would send '/../../test' as the path.
	// Since the path is now normalized, it will send '/test' instead.

	if (response.status === 400) {
		t.is(response.status, 400);

		const content = errorTemplate({
			statusCode: 400,
			message: 'Bad Request'
		});

		t.is(text, content);
	} else {
		t.is(response.status, 404);
	}
});

test('render file if directory only contains one', async t => {
	const directory = 'single-directory';
	const file = 'content.txt';
	const related = join(fixturesFull, directory, file);
	const content = await fs.promises.readFile(related, 'utf8');

	const { server, url } = await getUrl({
		renderSingle: true
	});

	const response = await fetch(`${url}/${directory}`);
	server.close();
	const text = await response.text();

	t.is(text, content);
});

test('correctly handle requests to /index if `cleanUrls` is enabled', async t => {
	const { server, url } = await getUrl();
	const target = `${url}/index`;

	const response = await fetch(target, {
		redirect: 'manual',
		follow: 0
	});
	server.close();

	const location = response.headers.get('location');
	t.is(location, `/`);
});

test('allow dots in `public` configuration property', async t => {
	const directory = 'public-folder.test';
	const root = join(fixturesTarget, directory);
	const file = join(fixturesFull, directory, 'index.html');

	const { server, url } = await getUrl({
		'public': root,
		'directoryListing': false
	});

	const response = await fetch(url);
	server.close();
	const text = await response.text();
	const content = await fs.promises.readFile(file, 'utf8');

	t.is(response.status, 200);
	t.is(content, text);
});

test('error for request with malformed URI', async t => {
	const { server, url } = await getUrl();
	const response = await fetch(`${url}/%E0%A4%A`);
	server.close();
	const text = await response.text();

	t.is(response.status, 400);

	const content = errorTemplate({
		statusCode: 400,
		message: 'Bad Request'
	});

	t.is(text, content);
});

test('error responses get custom headers', async t => {
	const { server, url } = await getUrl({
		'public': join(fixturesTarget, 'single-directory'),
		'headers': [{
			source: '**',
			headers: [{
				key: 'who',
				value: 'me'
			}]
		}]
	});

	const response = await fetch(`${url}/non-existing`);
	server.close();
	const text = await response.text();

	t.is(response.status, 404);
	t.is(response.headers.get('who'), 'me');

	const content = errorTemplate({
		statusCode: 404,
		message: 'The requested path could not be found'
	});

	t.is(text, content);
});

test('modify config in `createReadStream` handler', async t => {
	const name = '.dotfile';
	const related = join(fixturesFull, name);
	const content = await fs.promises.readFile(related, 'utf8');

	const config = {
		headers: []
	};

	const header = {
		key: 'X-Custom-Header',
		value: 'test'
	};

	const { server, url } = await getUrl(config, {
		createReadStream: async (file, opts) => {
			config.headers.unshift({
				source: name,
				headers: [header]
			});

			return fs.createReadStream(file, opts);
		}
	});

	const response = await fetch(`${url}/${name}`);
	server.close();
	const text = await response.text();
	const output = response.headers.get(header.key);

	t.deepEqual(content, text);
	t.deepEqual(output, header.value);
});

test('automatically handle ETag headers for normal files', async t => {
	const name = 'object.json';
	const related = join(fixturesFull, name);
	const content = await fs.promises.readFile(related, 'utf8');
	const value = '"d2ijdjoi29f3h3232"';

	const { server, url } = await getUrl({
		headers: [{
			source: '**',
			headers: [{
				key: 'ETag',
				value
			}]
		}]
	});

	const response = await fetch(`${url}/${name}`);
	const {headers} = response;

	const type = headers.get('content-type');
	const eTag = headers.get('etag');

	t.is(type, 'application/json; charset=utf-8');
	t.is(eTag, value);

	const text = await response.text();

	t.deepEqual(text, content);

	const cacheResponse = await fetch(`${url}/${name}`, {
		headers: {
			'if-none-match': value
		}
	});
	server.close();

	t.is(cacheResponse.status, 304);
});

test('range request without size', async t => {
	const name = 'docs.md';
	const related = join(fixturesFull, name);
	const content = await fs.promises.readFile(related);

	const config = {
		headers: []
	};

	const { server, url } = await getUrl(config, {
		lstat: async location => {
			const stats = await fs.promises.lstat(location);

			config.headers.unshift({
				source: '*',
				headers: [
					{
						key: 'Content-Length',
						value: stats.size
					}
				]
			});

			stats.size = null;
			return stats;
		}
	});

	const response = await fetch(`${url}/${name}`, {
		headers: {
			Range: 'bytes=0-10'
		}
	});
	server.close();

	const range = response.headers.get('content-range');
	const length = Number(response.headers.get('content-length'));

	t.is(range, null);

	// The full document is sent back
	t.is(length, 27);
	t.is(response.status, 200);

	const text = await response.text();
	t.is(text, content.toString());
});

test('range request', async t => {
	const name = 'docs.md';
	const related = join(fixturesFull, name);

	const content = await fs.promises.readFile(related);
	const { server, url } = await getUrl();

	const response = await fetch(`${url}/${name}`, {
		headers: {
			Range: 'bytes=0-10'
		}
	});
	server.close();

	const range = response.headers.get('content-range');
	const length = Number(response.headers.get('content-length'));

	t.is(range, `bytes 0-10/${content.length}`);
	t.is(length, 11);
	t.is(response.status, 206);

	const text = await response.text();
	const spec = content.toString().substr(0, 11);

	t.is(text, spec);
});

test('range request not satisfiable', async t => {
	const name = 'docs.md';
	const related = join(fixturesFull, name);

	const content = await fs.promises.readFile(related);
	const { server, url } = await getUrl();

	const response = await fetch(`${url}/${name}`, {
		headers: {
			Range: 'bytes=10-1'
		}
	});
	server.close();

	const range = response.headers.get('content-range');
	const length = Number(response.headers.get('content-length'));

	t.is(range, `bytes */${content.length}`);
	t.is(length, content.length);
	t.is(response.status, 416);

	const text = await response.text();
	const spec = content.toString();

	t.is(text, spec);
});

test('remove header when null', async t => {
	const key = 'Cache-Control';
	const value = 'max-age=7200';

	const list = [{
		source: 'object.json',
		headers: [{
			key: key,
			value: value
		}, {
			key: key,
			value: null
		}]
	}];

	const { server, url } = await getUrl({
		headers: list
	});

	const {headers} = await fetch(`${url}/object.json`);
	server.close();
	const cacheControl = headers.get(key);

	t.falsy(cacheControl);
});

test('errors in `createReadStream` get handled', async t => {
	const name = '.dotfile';

	// eslint-disable-next-line no-undefined
	const { server, url } = await getUrl(undefined, {
		createReadStream: () => {
			throw new Error('This is a test');
		}
	});

	const response = await fetch(`${url}/${name}`);
	server.close();
	const text = await response.text();

	const content = errorTemplate({
		statusCode: 500,
		message: 'A server error has occurred'
	});

	t.deepEqual(content, text);
	t.deepEqual(response.status, 500);
});

test('log error when checking `404.html` failed', async t => {
	// eslint-disable-next-line no-undefined
	const { server, url } = await getUrl(undefined, {
		console: {
			error: () => {}
		},
		createReadStream: (location, opts) => {
			if (basename(location) === '404.html') {
				throw new Error('Any error occured while checking the file');
			}

			return fs.createReadStream(location, opts);
		}
	});

	const response = await fetch(`${url}/not-existing`);
	server.close();
	const text = await response.text();

	t.is(response.status, 404);

	const content = errorTemplate({
		statusCode: 404,
		message: 'The requested path could not be found'
	});

	t.is(text, content);
});

test('prevent access to parent directory', async t => {
	const { server, url } = await getUrl({
		rewrites: [
			{source: '/secret', destination: '/404.html'}
		]
	});

	const response = await fetch(`${url}/dir/../secret`);
	server.close();
	const text = await response.text();

	t.is(text.trim(), '<span>Not Found</span>');
});

test('symlinks should not work by default', async t => {
	const name = 'symlinks/package.json';
	const { server, url } = await getUrl();

	const response = await fetch(`${url}/${name}`);
	server.close();
	const text = await response.text();

	t.is(response.status, 404);
	t.is(text.trim(), '<span>Not Found</span>');
});

test('allow symlinks by setting the option', async t => {
	const name = 'symlinks/package.json';
	const related = join(fixturesFull, name);
	const content = await fs.promises.readFile(related);

	const { server, url } = await getUrl({
		symlinks: true
	});

	const response = await fetch(`${url}/${name}`);
	server.close();
	const length = Number(response.headers.get('content-length'));

	t.is(length, content.length);
	t.is(response.status, 200);

	const text = await response.text();
	const spec = content.toString();

	t.is(text, spec);
});

test('etag header is set', async t => {
	const { server, url } = await getUrl({
		renderSingle: true,
		etag: true
	});

	let response = await fetch(`${url}/docs.md`);
	t.is(response.status, 200);
	t.is(
		response.headers.get('etag'),
		'"60be4422531fce1513df34cbcc90bed5915a53ef"'
	);

	response = await fetch(`${url}/docs.txt`);
	server.close();
	t.is(response.status, 200);
	t.is(
		response.headers.get('etag'),
		'"ba114dbc69e41e180362234807f093c3c4628f90"'
	);
});
