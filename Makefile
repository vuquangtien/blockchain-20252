.PHONY: setup test build check demo gas web preview package clean audit smoke-check

APP_DIR := app
CONTRACTS_DIR := contracts
PACKAGE_NAME := 20235625-VuQuangTien-blockchain-credential.zip

FORGE := $(shell which forge 2>/dev/null || which $(HOME)/.foundry/bin/forge 2>/dev/null || echo "")

setup:
	@if [ -z "$(FORGE)" ]; then \
		echo "Error: Foundry (forge) not found in PATH or in $(HOME)/.foundry/bin/forge."; \
		exit 1; \
	fi
	@if [ -d .git ]; then \
		echo "Initializing submodules..."; \
		git submodule update --init --recursive; \
	fi
	@if [ ! -f contracts/lib/forge-std/src/Test.sol ] || [ ! -f contracts/lib/openzeppelin-contracts/contracts/access/Ownable2Step.sol ]; then \
		echo "Error: Required vendored contract files are missing after submodule setup."; \
		exit 1; \
	fi
	cd $(APP_DIR) && npm ci

test:
	cd $(CONTRACTS_DIR) && $(FORGE) fmt --check && $(FORGE) test
	cd $(APP_DIR) && npm test

build:
	cd $(APP_DIR) && npm run build && npm run web:build

check: test build

audit:
	cd $(APP_DIR) && npm audit

demo:
	cd $(APP_DIR) && npm run demo:full

gas:
	cd $(CONTRACTS_DIR) && $(FORGE) snapshot

web:
	cd $(APP_DIR) && npm run web

preview:
	cd $(APP_DIR) && npm run web:preview -- --port 4173

package:
	rm -f $(PACKAGE_NAME)
	zip -r $(PACKAGE_NAME) \
		.github \
		.gitignore \
		.gitmodules \
		"Blockchain scale points.pdf" \
		LICENSE \
		Makefile \
		README.md \
		task.txt \
		app \
		contracts \
		docs \
		-x "app/node_modules/*" \
		-x "app/dist/*" \
		-x "app/dist-web/*" \
		-x "app/data/*" \
		-x "app/keys/*" \
		-x "contracts/cache/*" \
		-x "contracts/out/*" \
		-x "contracts/broadcast/*" \
		-x "*/.git" \
		-x "*/.git/*" \
		-x "docs/SKILL.md" \
		-x "task.md" \
		-x "walkthrough.md" \
		-x "*/task.md" \
		-x "*/walkthrough.md" \
		-x ".agents/*" \
		-x ".codex/*" \
		-x "*/.agents*" \
		-x "*/.codex*" \
		-x "*.zip" \
		-x "tmp-smoke-check/*" \
		-x "*.env" \
		-x "*.env.*" \
		-x "*/.env" \
		-x "*/.env.*"

smoke-check: package
	@echo "Checking archive hygiene..."
	@if unzip -Z -1 $(PACKAGE_NAME) | grep -E "(^|/)(\.git|node_modules|dist|dist-web|cache|out|broadcast|keys|data|\.agents|\.codex|task\.md|walkthrough\.md)($|/)|(^|/)\.env($|\.)|(^|/)docs/SKILL\.md($|/)" > /dev/null; then \
		echo "Error: Forbidden files or directories found in the archive:"; \
		unzip -Z -1 $(PACKAGE_NAME) | grep -E "(^|/)(\.git|node_modules|dist|dist-web|cache|out|broadcast|keys|data|\.agents|\.codex|task\.md|walkthrough\.md)($|/)|(^|/)\.env($|\.)|(^|/)docs/SKILL\.md($|/)"; \
		exit 1; \
	fi
	@echo "Archive hygiene check passed!"
	@TEMP_DIR=$$(mktemp -d /tmp/smoke-check.XXXXXX); \
	( \
		trap 'echo "Cleaning up temp dir $$TEMP_DIR..."; rm -rf $$TEMP_DIR' EXIT INT TERM; \
		echo "Created temp directory: $$TEMP_DIR"; \
		echo "Extracting package into temp dir $$TEMP_DIR..."; \
		unzip -q $(PACKAGE_NAME) -d $$TEMP_DIR && \
		echo "Running setup in temp dir..." && \
		$(MAKE) -C $$TEMP_DIR setup && \
		echo "Running check in temp dir..." && \
		$(MAKE) -C $$TEMP_DIR check \
	)

clean:
	rm -rf $(APP_DIR)/dist $(APP_DIR)/dist-web $(CONTRACTS_DIR)/cache $(CONTRACTS_DIR)/out tmp-smoke-check
