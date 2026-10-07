import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    'unknown';

  return NextResponse.json({
    commit,
    version: '4.0.0',
    timestamp: new Date().toISOString(),
  });
}
