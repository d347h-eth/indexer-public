import * as Sdk from "@reservoir0x/sdk";

import { getEventData } from "@/events-sync/data";
import { EnhancedEvent } from "@/events-sync/handlers/utils";
import * as erc721c from "@/utils/erc721c/index";
import { config } from "@/config/index";
import { logger } from "@/common/logger";

export const handleEvents = async (events: EnhancedEvent[]) => {
  for (const { subKind, baseEventParams, log } of events) {
    const eventData = getEventData([subKind])[0];

    switch (subKind) {
      // v1 + v2 + v3

      case "erc721c-set-transfer-security-level": {
        const parsedLog = eventData.abi.parseLog(log);
        const collection = parsedLog.args["collection"].toLowerCase();

        // Focus-mode gate: only process config for the focus collection
        if (config.focusCollectionAddress) {
          const focus = config.focusCollectionAddress.toLowerCase();
          if (collection !== focus) {
            logger.debug(
              "erc721c-handler",
              JSON.stringify({
                topic: "erc721cConfigUpdate",
                message: "Focus gate: skipping non-focus collection config",
                focus,
                collection,
                event: "set-transfer-security-level",
              })
            );
            break;
          }
        }

        await erc721c.refreshConfig(collection);

        break;
      }

      case "erc721c-transfer-validator-updated": {
        const collection = baseEventParams.address.toLowerCase();

        // Focus-mode gate: only process config for the focus collection
        if (config.focusCollectionAddress) {
          const focus = config.focusCollectionAddress.toLowerCase();
          if (collection !== focus) {
            logger.debug(
              "erc721c-handler",
              JSON.stringify({
                topic: "erc721cConfigUpdate",
                message: "Focus gate: skipping non-focus collection config",
                focus,
                collection,
                event: "transfer-validator-updated",
              })
            );
            break;
          }
        }

        await erc721c.refreshConfig(collection);

        break;
      }

      case "erc721c-verified-eoa-signature": {
        const parsedLog = eventData.abi.parseLog(log);
        const transferValidator = baseEventParams.address.toLowerCase();
        const address = parsedLog.args["account"].toLowerCase();

        await erc721c.saveVerifiedEOA(transferValidator, address);

        break;
      }

      // v1

      case "erc721c-v1-set-allowlist": {
        const parsedLog = eventData.abi.parseLog(log);
        const collection = parsedLog.args["collection"].toLowerCase();

        // Focus-mode gate: only process config for the focus collection
        if (config.focusCollectionAddress) {
          const focus = config.focusCollectionAddress.toLowerCase();
          if (collection !== focus) {
            logger.debug(
              "erc721c-handler",
              JSON.stringify({
                topic: "erc721cConfigUpdate",
                message: "Focus gate: skipping non-focus collection config",
                focus,
                collection,
                event: "v1-set-allowlist",
              })
            );
            break;
          }
        }

        await erc721c.refreshConfig(collection);

        break;
      }

      case "erc721c-v1-removed-from-allowlist":
      case "erc721c-v1-added-to-allowlist": {
        const parsedLog = eventData.abi.parseLog(log);
        const id = parsedLog.args["id"].toString();
        const transferValidator = baseEventParams.address.toLowerCase();

        parsedLog.args.kind === 0
          ? await erc721c.v1.refreshOperatorWhitelist(transferValidator, id)
          : await erc721c.v1.refreshPermittedContractReceiverAllowlist(transferValidator, id);

        break;
      }

      // v2 + v3

      case "erc721c-v2-v3-applied-list-to-collection": {
        const parsedLog = eventData.abi.parseLog(log);
        const collection = parsedLog.args["collection"].toLowerCase();

        // Focus-mode gate: only process config for the focus collection
        if (config.focusCollectionAddress) {
          const focus = config.focusCollectionAddress.toLowerCase();
          if (collection !== focus) {
            logger.debug(
              "erc721c-handler",
              JSON.stringify({
                topic: "erc721cConfigUpdate",
                message: "Focus gate: skipping non-focus collection config",
                focus,
                collection,
                event: "v2-v3-applied-list-to-collection",
              })
            );
            break;
          }
        }

        await erc721c.refreshConfig(collection);
        break;
      }

      case "erc721c-v2-v3-removed-account-from-list":
      case "erc721c-v2-v3-removed-code-hash-from-list":
      case "erc721c-v2-v3-added-account-to-list":
      case "erc721c-v2-v3-added-code-hash-to-list": {
        const parsedLog = eventData.abi.parseLog(log);
        const id = parsedLog.args["id"].toString();

        const transferValidator = baseEventParams.address.toLowerCase();
        if (transferValidator === Sdk.Erc721c.Addresses.TransferValidatorV2[config.chainId]) {
          parsedLog.args.kind === 0
            ? await erc721c.v2.refreshBlacklist(transferValidator, id)
            : await erc721c.v2.refreshWhitelist(transferValidator, id);
        } else if (
          transferValidator === Sdk.Erc721c.Addresses.TransferValidatorV3[config.chainId] ||
          transferValidator === Sdk.Erc721c.Addresses.TransferValidatorV4[config.chainId] ||
          transferValidator === Sdk.Erc721c.Addresses.TransferValidatorV5[config.chainId]
        ) {
          const { authorizers, additionalContracts } = await erc721c.v3.getAdditionalListContracts(
            transferValidator,
            id
          );

          parsedLog.args.kind === 0
            ? await erc721c.v3.refreshBlacklist(
                transferValidator,
                id,
                authorizers,
                additionalContracts
              )
            : await erc721c.v3.refreshWhitelist(
                transferValidator,
                id,
                authorizers,
                additionalContracts
              );
        }

        break;
      }
    }
  }
};
