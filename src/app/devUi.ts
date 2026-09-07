export function isDevUiEnabled(search: string = defaultSearch()): boolean {
  try {
    return new URLSearchParams(search).get('dev') === '1';
  } catch {
    return false;
  }
}

function defaultSearch(): string {
  try {
    return window.location.search;
  } catch {
    return '';
  }
}
