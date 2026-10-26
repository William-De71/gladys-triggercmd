# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - unreleased

### Added

- **devices:** one device per computer of a TRIGGERcmd account (Windows, Mac, Linux, Raspberry Pi with the TRIGGERcmd agent), one feature per command: a push button, or an on/off switch for a command that accepts parameters; the commands read every 15 minutes and on demand
- **scenes:** an action to run a command on a computer by their names, with parameters, and one to read the commands again; triggers when a command of the Gladys computer is run, when TRIGGERcmd refuses a command Gladys sent and when it refuses the token
- **gladys computer:** optional, Gladys shows up in TRIGGERcmd as a computer whose commands start Gladys scenes in real time (Alexa, Google Assistant, panels, IFTTT, AI assistants), its commands kept in line with the configuration
- **widget:** the last runs, sent or received, with a "Run a command" form listing the commands and their parameters, and a Refresh button
- **configuration:** token with a guide, the Gladys computer, its name and its commands, "Test the connection" and "Diagnostic" buttons
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README
