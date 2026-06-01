.PHONY: setup test build check demo gas web preview package clean

APP_DIR := app
CONTRACTS_DIR := contracts
PACKAGE_NAME := 20235625-VuQuangTien-blockchain-credential.zip

setup:
	cd $(APP_DIR) && npm install
	cd $(CONTRACTS_DIR) && forge install

test:
	cd $(CONTRACTS_DIR) && forge fmt --check && forge test
	cd $(APP_DIR) && npm test

build:
	cd $(APP_DIR) && npm run build && npm run web:build

check: test build
	cd $(APP_DIR) && npm audit

demo:
	cd $(APP_DIR) && npm run demo:full

gas:
	cd $(CONTRACTS_DIR) && forge snapshot

web:
	cd $(APP_DIR) && npm run web

preview:
	cd $(APP_DIR) && npm run web:preview -- --port 4173

package:
	rm -f $(PACKAGE_NAME)
	zip -r $(PACKAGE_NAME) . \
		-x "app/node_modules/*" \
		-x "app/dist/*" \
		-x "app/dist-web/*" \
		-x "app/data/*" \
		-x "app/keys/*" \
		-x "contracts/cache/*" \
		-x "contracts/out/*" \
		-x "contracts/broadcast/*" \
		-x "contracts/lib/*" \
		-x ".git/*"

clean:
	rm -rf $(APP_DIR)/dist $(APP_DIR)/dist-web $(CONTRACTS_DIR)/cache $(CONTRACTS_DIR)/out
