//#region ../node_modules/.pnpm/html-escaper@3.0.3/node_modules/html-escaper/esm/index.js
/**
* Copyright (C) 2017-present by Andrea Giammarchi - @WebReflection
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in
* all copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
* THE SOFTWARE.
*/
var { replace } = "";
var es = /&(?:amp|#38|lt|#60|gt|#62|apos|#39|quot|#34);/g;
var ca = /[&<>'"]/g;
var esca = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"'": "&#39;",
	"\"": "&quot;"
};
var pe = (m) => esca[m];
/**
* Safely escape HTML entities such as `&`, `<`, `>`, `"`, and `'`.
* @param {string} es the input to safely escape
* @returns {string} the escaped input, and it **throws** an error if
*  the input type is unexpected, except for boolean and numbers,
*  converted as string.
*/
var escape = (es) => replace.call(es, ca, pe);
var unes = {
	"&amp;": "&",
	"&#38;": "&",
	"&lt;": "<",
	"&#60;": "<",
	"&gt;": ">",
	"&#62;": ">",
	"&apos;": "'",
	"&#39;": "'",
	"&quot;": "\"",
	"&#34;": "\""
};
var cape = (m) => unes[m];
/**
* Safely unescape previously escaped entities such as `&`, `<`, `>`, `"`,
* and `'`.
* @param {string} un a previously escaped string
* @returns {string} the unescaped input, and it **throws** an error if
*  the input type is unexpected, except for boolean and numbers,
*  converted as string.
*/
var unescape = (un) => replace.call(un, es, cape);
//#endregion
export { escape, unescape };
