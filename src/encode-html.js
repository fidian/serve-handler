const encodeHTMLRules = {
    "&": "&#38;",
    "<": "&#60;",
    ">": "&#62;",
    '"': "&#34;",
    "'": "&#39;",
    "/": "&#47;"
};
const matchHTML = /&(?!#?\w+;)|<|>|"|'|\//g;

export function encodeHTML(code) {
    return code
        ? code.toString().replace(matchHTML, (m) => {
              return encodeHTMLRules[m] || m;
          })
        : "";
}
