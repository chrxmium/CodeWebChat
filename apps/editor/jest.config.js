module.exports = {
  preset: 'ts-jest',
  testMatch: ['<rootDir>/src/**/*.spec.ts?(x)'],
  moduleNameMapper: {
    '^@cwc/core$': '<rootDir>/../../packages/core/src/index',
    '^@cwc/core/(.*)$': '<rootDir>/../../packages/core/src/$1',
    '^@shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1'
  },
}
