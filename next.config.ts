import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdfkit', 'pptxgenjs'],
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring-tunnel',
  disableLogger: true,
  automaticVercelMonitors: true,
});
