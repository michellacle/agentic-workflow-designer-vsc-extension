module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'ES2022',
          lib: ['ES2022'],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          moduleResolution: 'node',
          allowSyntheticDefaultImports: true
        }
      }
    ]
  },
  testMatch: ['**/test/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transformIgnorePatterns: [
    "node_modules/(?!(jsdom|@exodus|html-encoding-sniffer|whatwg-encoding|webidl-conversions|cssstyle|cssom|saxes|@exodus/bytes)/)"
  ],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/node_modules/@types/vscode/index'
  }
};
