// Browser stub for Node's fs/promises. The Thetanuts SDK only touches fs in
// its RFQ keystore, which Monsoon never uses client-side.
const reject = () => Promise.reject(new Error("fs not available in the browser"));
export const readFile = reject;
export const writeFile = reject;
export const mkdir = reject;
export const rm = reject;
export const stat = reject;
export const chmod = reject;
export const rename = reject;
export default { readFile, writeFile, mkdir, rm, stat, chmod, rename };
