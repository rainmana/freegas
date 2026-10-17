# Contributing

Welcome to the pit crew. Freegas is a local inference router with a fuel problem and a sense of humor.

Run `npm run check` and `npm test` with Node.js 22.16+ before submitting code. Tests use local mock providers; do not add real API keys or paid inference calls to CI.

For Pre-rolls (provider lists), include provider documentation supporting endpoint URLs, model IDs, capabilities, and free-tier terms. Separate trial credits from ongoing free tiers. Never include actual keys. Lists select destinations for prompts and credentials, so changes to endpoints deserve careful review. See [the format and trust model](docs/lists.md).

Fuel jokes belong in help text, documentation, and readable error messages. Keep machine-readable error codes stable and pair every joke with an actionable explanation. Nobody should need to understand the bit to fix their configuration.

While this repository is primarily maintained by the author, constructive contributions, bug reports, documentation improvements, and suggestions are always welcome.

---

## Ways to Contribute

You can contribute by:

- Reporting bugs
- Suggesting new features or improvements
- Improving documentation
- Fixing typos or grammatical errors
- Submitting pull requests

---

## Development Guidelines

Please follow these general guidelines when contributing:

- Keep changes focused and well documented.
- Follow the existing project structure and coding style.
- Write clear and maintainable code.
- Update documentation whenever necessary.
- Ensure all GitHub Actions workflows pass successfully.

---

## Documentation Standards

When updating documentation:

- Use clear English. Gas station humor is encouraged; confusing instructions are not.
- Keep the README accurate and up to date.
- Use proper Markdown formatting.
- Update screenshots when applicable.

---

## Security Guidelines

To help keep this repository secure:

- Never commit secrets, credentials, or API keys.
- Keep dependencies up to date.
- Follow the guidance described in `SECURITY.md`.
- Report security issues responsibly.

---

## Pull Requests

Before submitting a pull request:

- Verify that your changes are complete.
- Keep pull requests focused on a single topic.
- Provide a clear description of the changes.
- Update documentation if required.

---

## Reporting Issues

If you find a bug or have a suggestion, please open a GitHub Issue with as much relevant information as possible.

---

## Code of Conduct

By participating in this project, you agree to follow the guidelines described in the `CODE_OF_CONDUCT.md`.

Thank you for helping improve this project.
