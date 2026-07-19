// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
      // Enforce AGENTS.md rule 23: signal-based input()/output()/viewChild()/
      // contentChild() only, never the legacy @Input()/@ViewChild()/
      // @ContentChild() (prefer-signals) or @Output() (prefer-output-emitter-ref)
      // decorators. Neither is enabled by angular.configs.tsRecommended by default.
      // preferReadonlySignalProperties is off — that's a separate style
      // convention (marking every signal() property readonly) this codebase
      // doesn't follow yet and isn't what rule 23 is about; flipping it on
      // surfaces ~190 unrelated pre-existing errors.
      '@angular-eslint/prefer-signals': ['error', { preferReadonlySignalProperties: false }],
      '@angular-eslint/prefer-output-emitter-ref': 'error',
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);
