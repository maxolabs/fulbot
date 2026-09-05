import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    ignores: [
      '**/.next/**',
      '**/out/**',
      '**/build/**',
      'next-env.d.ts',
      '**/node_modules/**',
      '.claude/**',
    ],
  },
]

export default eslintConfig
