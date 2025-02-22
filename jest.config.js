module.exports = {
    preset: 'ts-jest/presets/js-with-ts',
    testEnvironment: 'node',
    clearMocks: true,
    globals: {
        'ts-jest': {
            tsconfig: 'tsconfig.jest.json',
        }
    },
    setupFilesAfterEnv: ['jest-extended/all']
}
