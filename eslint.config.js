const js = require("@eslint/js");

module.exports = [
    {
        files: ["**/*.js"],
        ignores: ["node_modules/**", "dist/**"],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: "commonjs", 
            globals: {
                require: "readonly",
                module: "readonly",
                process: "readonly",
                console: "readonly",
                global: "readonly",
                setTimeout: "readonly",
                AbortController: "readonly",
            },
        },
        rules: {
            ...js.configs.recommended.rules,
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "no-console": "off",
        },
    },
];
