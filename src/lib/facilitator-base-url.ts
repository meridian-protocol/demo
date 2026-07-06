const DEFAULT_FACILITATOR_URL = "https://api.mrdn.finance";

export function getFacilitatorOrigin(): string {
  const raw = (
    process.env.FACILITATOR_URL ||
    process.env.NEXT_PUBLIC_FACILITATOR_URL ||
    DEFAULT_FACILITATOR_URL
  ).trim();

  let base = raw.replace(/\/+$/, "");
  if (base.endsWith("/v1")) {
    base = base.slice(0, -3).replace(/\/+$/, "");
  }

  return base || DEFAULT_FACILITATOR_URL;
}

export function facilitatorApiUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${getFacilitatorOrigin()}${suffix}`;
}

