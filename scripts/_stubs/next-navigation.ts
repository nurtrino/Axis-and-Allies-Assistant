export function redirect(url: string): never {
  const e = new Error("NEXT_REDIRECT:" + url) as Error & { __redirect: string };
  e.__redirect = url;
  throw e;
}
export function notFound(): never { throw new Error("NEXT_NOT_FOUND"); }
