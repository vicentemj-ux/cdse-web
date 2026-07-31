import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    envPrefix: ['PUBLIC_', 'NEXT_PUBLIC_'],
    resolve: {
      dedupe: ['tslib', '@supabase/supabase-js'],
    },
  },
  output: 'static'
});
