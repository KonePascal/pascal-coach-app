/** Tests nur für die reine Logik in src/domain (kein React Native nötig). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/domain'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true, isolatedModules: true, rootDir: '.', types: ['jest'] } }] },
};
