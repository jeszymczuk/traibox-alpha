export async function GET(request) { return fetch(request.nextUrl.searchParams.get('url')); }
