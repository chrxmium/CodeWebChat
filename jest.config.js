/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  projects: [
    '<rootDir>/apps/editor',
    {
      preset: 'ts-jest',
      testMatch: [
        '<rootDir>/apps/editor/src/**/*.spec.ts?(x)',
        '<rootDir>/apps/sidecar/src/**/*.spec.ts?(x)',
        '<rootDir>/packages/core/**/*.spec.ts?(x)',
        '<rootDir>/packages/shared/**/*.spec.ts?(x)'
      ],
      testPathIgnorePatterns: [
        '<rootDir>/apps/editor/'
      ],
      moduleNameMapper: {
        '^@shared/(.*)$': '<rootDir>/packages/shared/src/$1',
        '^@cwc/core$': '<rootDir>/packages/core/src/index',
        '^@cwc/core/(.*)$': '<rootDir>/packages/core/src/$1'
      },
    }
  ]
}
