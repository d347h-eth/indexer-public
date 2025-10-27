import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";

import { logger } from "@/common/logger";
import { idb } from "@/common/db";
import { toBuffer } from "@/common/utils";
import { initOnChainData, processOnChainData } from "@/events-sync/handlers/utils";
import {
  detectTokenStandard,
  getContractDeployer,
  getContractNameAndSymbol,
  getContractOwner,
} from "@/jobs/collections/utils";
import { onchainMetadataProvider } from "@/metadata/providers/onchain-metadata-provider";
import * as royalties from "@/utils/royalties";
import * as onchain from "@/utils/royalties/onchain";
import { config } from "@/config/index";

export type CollectionContractDeployed = {
  contract: string;
  deployer?: string;
  blockTimestamp?: number;
};

const BLACKLISTED_DEPLOYERS = [
  "0xaf18644083151cf57f914cccc23c42a1892c218e",
  "0x9ec1c3dcf667f2035fb4cd2eb42a1566fd54d2b7",
  "0xc0edd4902879a7e85b4bd2dfe293dbec4d838c2d",
  "0x0000000000771a79d0fc7f3b7fe270eb4498f20b",
];

export class CollectionNewContractDeployedJob extends AbstractRabbitMqJobHandler {
  queueName = "collection-new-contract-deployed";
  maxRetries = 10;
  concurrency = 10;
  persistent = false;

  public async process(payload: CollectionContractDeployed) {
    const { contract } = payload;
    let deployer = payload.deployer || null;

    if (!contract) {
      logger.error(this.queueName, `Missing contract`);
      return;
    }

    // Focus-mode gate: only process the focus collection contract
    if (config.focusCollectionAddress) {
      const focus = config.focusCollectionAddress.toLowerCase();
      if (contract.toLowerCase() !== focus) {
        logger.debug(
          this.queueName,
          JSON.stringify({
            topic: "collectionContractDeployed",
            message: `Focus gate: skipping non-focus contract deployment`,
            focus,
            contract,
          })
        );
        return;
      }
    }

    if (!deployer) {
      deployer = await getContractDeployer(contract);
    }

    if (deployer && BLACKLISTED_DEPLOYERS.includes(deployer)) {
      return;
    }

    // get the type of the collection, either ERC721 or ERC1155. if it's not one of those, we don't care
    // get this from the contract itself
    const collectionKind = await detectTokenStandard(contract);

    switch (collectionKind) {
      case "ERC721":
      case "ERC1155":
        break;
      case "Both":
        logger.warn(
          this.queueName,
          `Collection ${contract} is both ERC721 and ERC1155. This is not supported yet.`
        );
        return;
      default:
        return;
    }

    const rawMetadata = await onchainMetadataProvider.getContractURI(contract);
    const contractNameAndSymbol = await getContractNameAndSymbol(contract);

    const name = contractNameAndSymbol.name ?? rawMetadata?.name;
    const symbol = contractNameAndSymbol.symbol ?? rawMetadata?.symbol;

    let collectionMetadata = null;

    try {
      collectionMetadata = onchainMetadataProvider.parseCollection({
        ...rawMetadata,
        contract,
        name: rawMetadata?.name ?? name,
      });
    } catch (error) {
      logger.error(
        this.queueName,
        `Error getting contract metadata. contract=${contract}, error=${error}`
      );
    }

    const contractOwner = await getContractOwner(contract);

    logger.log(
      config.debugMetadataIndexingCollections.includes(contract) ? "info" : "debug",
      this.queueName,
      JSON.stringify({
        topic: "CollectionNewContractDeployedJob",
        message: `Debug. contract=${contract}, name=${name}`,
        payload,
        rawMetadata,
        collectionMetadata,
        debugMetadataIndexingCollection: config.debugMetadataIndexingCollections.includes(contract),
      })
    );

    await Promise.all([
      idb.none(
        `
          INSERT INTO contracts (
              address,
              kind,
              symbol,
              name,
              deployed_at,
              metadata,
              deployer,
              owner
          ) VALUES (
            $/address/,
            $/kind/,
            $/symbol/,
            $/name/,
            $/deployed_at/,
            $/metadata:json/,
            $/deployer/,
            $/owner/
          )
          ON CONFLICT (address)
          DO UPDATE SET
            symbol = COALESCE(EXCLUDED.symbol, contracts.symbol),
            name = COALESCE(EXCLUDED.name, contracts.name),
            deployed_at = COALESCE(EXCLUDED.deployed_at, contracts.deployed_at),
            metadata = COALESCE(EXCLUDED.metadata, contracts.metadata),
            deployer = COALESCE(EXCLUDED.deployer, contracts.deployer),
            owner = COALESCE(EXCLUDED.owner, contracts.owner),
            is_offchain = FALSE,
            updated_at = now()
        `,
        {
          address: toBuffer(contract),
          kind: collectionKind.toLowerCase(),
          symbol: symbol || null,
          name: name || null,
          deployed_at: payload.blockTimestamp ? new Date(payload.blockTimestamp * 1000) : null,
          metadata: rawMetadata ? rawMetadata : null,
          deployer: deployer ? toBuffer(deployer) : null,
          owner: contractOwner ? toBuffer(contractOwner) : null,
        }
      ),
      name
        ? idb.none(
            `
              INSERT INTO collections (
                id,
                name,
                contract,
                creator,
                token_id_range,
                token_set_id,
                metadata
              ) VALUES (
                $/id/,
                $/name/,
                $/contract/,
                $/creator/,
                '(,)'::numrange,
                $/tokenSetId/,
                $/metadata:json/
              ) ON CONFLICT (id) DO UPDATE SET creator = EXCLUDED.creator, updated_at = NOW() WHERE collections.creator IS NULL
            `,
            {
              id: contract,
              name: name || null,
              contract: toBuffer(contract),
              creator: contractOwner
                ? toBuffer(contractOwner)
                : deployer
                ? toBuffer(deployer)
                : null,
              tokenSetId: `contract:${contract}`,
              metadata: collectionMetadata?.metadata ? collectionMetadata?.metadata : null,
            }
          )
        : null,
    ]);

    if (name) {
      try {
        // Refresh the on-chain royalties
        await onchain.refreshOnChainRoyalties(contract, "onchain");
        await onchain.refreshOnChainRoyalties(contract, "eip2981");
        await royalties.refreshDefaultRoyalties(contract, this.queueName);
      } catch (error) {
        logger.error(
          this.queueName,
          `Refreshing deployed collection on chain royalties error. collectionId=${contract}, error=${error}`
        );
      }
    }

    // If there is a `mintConfig` field in the metadata we use that to extract the mint phases
    if (rawMetadata?.mintConfig) {
      const onChainData = initOnChainData();

      onChainData.mints.push({
        by: "contractMetadata",
        data: {
          collection: contract,
          metadata: rawMetadata,
          deployer,
        },
      });

      await processOnChainData(onChainData, false);
    }
  }

  public async addToQueue(params: CollectionContractDeployed, delay = 0) {
    await this.send(
      { payload: params, jobId: params.deployer ? undefined : params.contract },
      delay
    );
  }
}

export const collectionNewContractDeployedJob = new CollectionNewContractDeployedJob();
