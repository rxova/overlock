module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Length is a review concern, not a machine one. A pasted diff hunk, a rule
    // ID table or a wrapped explanation in a commit body is not a defect.
    'header-max-length': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'rename',
        'revert',
        'style',
        'test',
      ],
    ],
  },
};
