import { NextRequest } from 'next/server';

import { proxyBrowserRequest } from '../../../../server/browser-security/proxy';

type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: Context) {
  const { path } = await context.params;
  return proxyBrowserRequest(request, path);
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
