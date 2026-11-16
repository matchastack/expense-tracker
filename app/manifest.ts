import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'My Finance',
    short_name: 'Finance',
    description: 'Personal expense, income and net worth tracker.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f5f1',
    theme_color: '#f6f5f1',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Add expense', short_name: 'Expense', url: '/?add=expense' },
      { name: 'Add income', short_name: 'Income', url: '/?add=income' },
    ],
  };
}
