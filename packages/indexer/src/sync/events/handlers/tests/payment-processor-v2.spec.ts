import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock("@/pubsub/index", () => {
  return {
    PubSub: {
      publish: jest.fn(),
    },
  };
});

import * as Sdk from "@reservoir0x/sdk";

import { config } from "@/config/index";
const chainId = config.chainId;

Sdk.Common.Addresses.Usdc[chainId] = [
  "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359".toLowerCase(),
  "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359".toLowerCase(),
];

jest.mock("@/jobs/token-set-updates/top-bid-queue-job", () => {
  return jest.fn();
});

import traces from "./traces.json";

import { fetchTransactionTrace } from "@/events-sync/utils";

jest.mock("@/events-sync/utils", () => {
  return {
    fetchTransactionTrace: jest.fn((txHash) => {
      return (traces as any)[txHash];
    }),
    extractAttributionData: jest.fn(() => {
      return {};
    }),
  };
});
jest.mock("@/jobs/order-fixes/order-fixes-job", () => {
  return {
    orderFixesJob: {
      addToQueue: jest.fn(),
    },
  };
});

import { handleEvents } from "../payment-processor-v2";
// import { getEventData } from "@/events-sync/data";
import { Addresses } from "@reservoir0x/sdk/src/payment-processor-v2";
import { getEventData } from "@/events-sync/data";
Addresses.Exchange[config.chainId] = "0x9A1D00bEd7CD04BCDA516d721A596eb22Aac6834".toLowerCase();

describe("postTokensOverrideV1Options tests", () => {
  const subKinds = [
    "payment-processor-v2-accept-offer-erc1155",
    "payment-processor-v2-accept-offer-erc721",
    "payment-processor-v2-buy-listing-erc1155",
    "payment-processor-v2-buy-listing-erc721",
  ];
  const topics = [
    "0x6f4c56c4b9a9d2479f963d802b19d17b02293ce1225461ac0cb846c482ee3c3e",
    "0x8b87c0b049fe52718fe6ff466b514c5a93c405fb0de8fbd761a23483f9f9e198",
    "0x1217006325a98bdcc6afc9c44965bb66ac7460a44dc57c2ac47622561d25c45a",
    "0xffb29e9cf48456d56b6d414855b66a7ec060ce2054dcb124a1876310e1b7355c",
  ];

  const address = Addresses.Exchange[config.chainId];
  Sdk.PaymentProcessorV2.Addresses.Exchange[config.chainId] = address;

  const eventAcceptOffer1155 =
    '{"data":{"subKind":"payment-processor-v2-accept-offer-erc1155","baseEventParams":{"blockHash":"0x9e30115c71b1056473fadb529aba636086886c49ee19cd7dde2daa1266bccea3","block":67020650,"from":"0x02C435d8189D9a983CDBD77F2109fdd5663A33BB","timestamp":1740003831,"value":{"type":"BigNumber","hex":"0x00"},"txHash":"0xbaccc59fa2716d338884a895cd86c5b4a60722a933860014b3967e48a603298a","to":"0x5ebc127fae83ed5bdd91fc6a5f5767E259dF5642","logIndex":154},"log":{"transactionIndex":31,"blockNumber":67020650,"transactionHash":"0xbaccc59fa2716d338884a895cd86c5b4a60722a933860014b3967e48a603298a","address":"0x9A1D00bEd7CD04BCDA516d721A596eb22Aac6834","topics":["0x6f4c56c4b9a9d2479f963d802b19d17b02293ce1225461ac0cb846c482ee3c3e","0x00000000000000000000000002c435d8189d9a983cdbd77f2109fdd5663a33bb","0x000000000000000000000000090c6f36df8a3a803bcbbe5fb26a91d036fe669d","0x0000000000000000000000002953399124f0cbb46d2cbacd8a89cf0599974963"],"data":"0x000000000000000000000000090c6f36df8a3a803bcbbe5fb26a91d036fe669d0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf1270385912ffbf62d52d1361d6f088228e1f669488110000000000003100000005dc0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000016345785d8a0000","logIndex":154,"blockHash":"0x9e30115c71b1056473fadb529aba636086886c49ee19cd7dde2daa1266bccea3"}}}';
  const eventAcceptOffer721 =
    '{"data":{"subKind":"payment-processor-v2-accept-offer-erc721","baseEventParams":{"blockHash":"0x4d6034909724f10d97df2493b17428326f641c73fa475b7089c7ee4a5bd32e3c","block":66982485,"from":"0xA73918cADd15305D33a9af1615F56759A8fb7fdB","timestamp":1740005436,"value":{"type":"BigNumber","hex":"0x00"},"txHash":"0x82d887afa7d2abb4ceb5281ea1148ed48ff27ca6a97920d4a9bfa2bdc845fc2a","to":"0x5ebc127fae83ed5bdd91fc6a5f5767E259dF5642","logIndex":179,"address":"0x9A1D00bEd7CD04BCDA516d721A596eb22Aac6834"},"log":{"transactionIndex":38,"blockNumber":66982485,"transactionHash":"0x82d887afa7d2abb4ceb5281ea1148ed48ff27ca6a97920d4a9bfa2bdc845fc2a","address":"0x9A1D00bEd7CD04BCDA516d721A596eb22Aac6834","topics":["0x8b87c0b049fe52718fe6ff466b514c5a93c405fb0de8fbd761a23483f9f9e198","0x000000000000000000000000a73918cadd15305d33a9af1615f56759a8fb7fdb","0x000000000000000000000000a6b133935e4d9de6a8c7a29f93d6da400a365585","0x00000000000000000000000024a11e702cd90f034ea44faf1e180c0c654ac5d9"],"data":"0x000000000000000000000000a6b133935e4d9de6a8c7a29f93d6da400a3655850000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000064950000000000000000000000000000000000000000000000410d586a20a4c00000","logIndex":179,"blockHash":"0x4d6034909724f10d97df2493b17428326f641c73fa475b7089c7ee4a5bd32e3c"}}}';
  const eventBuyListing1155 =
    '{"data":{"subKind":"payment-processor-v2-buy-listing-erc1155","baseEventParams":{"blockHash":"0x5cf23df8abcd2e9656c9c653f5797db8ca1a0c6592bef11b6945a86d1269e2c9","block":66979978,"from":"0x8F69dd70c090c4799a1B6A22dB598c9e9f88e651","timestamp":1740005519,"value":{"type":"BigNumber","hex":"0x09184e72a000"},"txHash":"0x2cf61e4ebe0579d6b99696f4044716d7fe1d79eb2647a38f68779cac20eedc66","to":"0xb233e3602BB06AA2c2dB0982BBaf33c2b15184C9","logIndex":283,"address":"0x9A1D00bEd7CD04BCDA516d721A596eb22Aac6834"},"log":{"transactionIndex":76,"blockNumber":66979978,"transactionHash":"0x2cf61e4ebe0579d6b99696f4044716d7fe1d79eb2647a38f68779cac20eedc66","address":"0x9A1D00bEd7CD04BCDA516d721A596eb22Aac6834","topics":["0x1217006325a98bdcc6afc9c44965bb66ac7460a44dc57c2ac47622561d25c45a","0x0000000000000000000000008f69dd70c090c4799a1b6a22db598c9e9f88e651","0x00000000000000000000000003508bb71268bba25ecacc8f620e01866650532c","0x00000000000000000000000071e0f5149fa87d2b8997a7ea688eb8e794f02b5b"],"data":"0x0000000000000000000000008f69dd70c090c4799a1b6a22db598c9e9f88e651000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000009184e72a000","logIndex":283,"blockHash":"0x5cf23df8abcd2e9656c9c653f5797db8ca1a0c6592bef11b6945a86d1269e2c9"}}}';
  const eventBuyListing721 =
    '{"data":{"subKind":"payment-processor-v2-buy-listing-erc721","baseEventParams":{"blockHash":"0xf7e5349e565bf9c20cf26c0bbbfa5fcb80a5997573f3572a2f8b86756a8759fb","block":66979937,"from":"0x526A56e293E1d3af3373CA660a676BDdE726532e","timestamp":1740005555,"value":{"type":"BigNumber","hex":"0x4e7128b177263c0000"},"txHash":"0xdafff560957ed17a065f6ac94ddca9415c56187f79ceaf0ee7b0586a7ec0b4f8","to":"0x5ebc127fae83ed5bdd91fc6a5f5767E259dF5642","logIndex":367,"address":"0x9A1D00bEd7CD04BCDA516d721A596eb22Aac6834"},"log":{"transactionIndex":123,"blockNumber":66979937,"transactionHash":"0xdafff560957ed17a065f6ac94ddca9415c56187f79ceaf0ee7b0586a7ec0b4f8","address":"0x9A1D00bEd7CD04BCDA516d721A596eb22Aac6834","topics":["0xffb29e9cf48456d56b6d414855b66a7ec060ce2054dcb124a1876310e1b7355c","0x000000000000000000000000526a56e293e1d3af3373ca660a676bdde726532e","0x000000000000000000000000a6335939199c170d87c790b57e7c18aff6a7ce5e","0x00000000000000000000000024a11e702cd90f034ea44faf1e180c0c654ac5d9"],"data":"0x000000000000000000000000526a56e293e1d3af3373ca660a676bdde726532e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006f0500000000000000000000000000000000000000000000004e7128b177263c0000","logIndex":367,"blockHash":"0xf7e5349e565bf9c20cf26c0bbbfa5fcb80a5997573f3572a2f8b86756a8759fb"}}}';

  it("can add beneficiary to payment-processor-v2-accept-offer-erc1155", async () => {
    const onChainData = {
      fillEventsPartial: [],
      fillInfos: [],
      orderInfos: [],
      makerInfos: [],
    } as any;
    const events = [JSON.parse(eventAcceptOffer1155).data];

    expect(subKinds.includes(events[0].subKind)).toBeTruthy();

    const txTrace = await fetchTransactionTrace(events[0].baseEventParams.txHash);
    expect(txTrace?.calls).toBeTruthy();

    await handleEvents(events, onChainData);
    expect(onChainData.fillEventsPartial.length).toBeTruthy();
    expect(onChainData.fillInfos.length).toBeTruthy();

    const eventData = getEventData([events[0].subKind])[0];
    const log = events[0].log;
    expect(topics.includes(log.topics[0])).toBeTruthy();

    const parsedLog = eventData.abi.parseLog(log);
    const isBeneficiary = onChainData.fillEventsPartial[0].taker === parsedLog.args.beneficiary;
    expect(isBeneficiary).toBeTruthy();
  });

  it("can add beneficiary to payment-processor-v2-accept-offer-erc721", async () => {
    const onChainData = {
      fillEventsPartial: [],
      fillInfos: [],
      orderInfos: [],
      makerInfos: [],
    } as any;
    const events = [JSON.parse(eventAcceptOffer721).data];

    expect(subKinds.includes(events[0].subKind)).toBeTruthy();

    const txTrace = await fetchTransactionTrace(events[0].baseEventParams.txHash);
    expect(txTrace?.calls).toBeTruthy();

    await handleEvents(events, onChainData);
    expect(onChainData.fillEventsPartial.length).toBeTruthy();
    expect(onChainData.fillInfos.length).toBeTruthy();

    const eventData = getEventData([events[0].subKind])[0];
    const log = events[0].log;
    expect(topics.includes(log.topics[0])).toBeTruthy();

    const parsedLog = eventData.abi.parseLog(log);
    const isBeneficiary = onChainData.fillEventsPartial[0].taker === parsedLog.args.beneficiary;
    expect(isBeneficiary).toBeTruthy();
  });

  it("can add beneficiary to payment-processor-v2-buy-listing-erc1155", async () => {
    const onChainData = {
      fillEventsPartial: [],
      fillInfos: [],
      orderInfos: [],
      makerInfos: [],
    } as any;
    const events = [JSON.parse(eventBuyListing1155).data];

    expect(subKinds.includes(events[0].subKind)).toBeTruthy();

    const txTrace = await fetchTransactionTrace(events[0].baseEventParams.txHash);
    expect(txTrace?.calls).toBeTruthy();

    await handleEvents(events, onChainData);
    expect(onChainData.fillEventsPartial.length).toBeTruthy();
    expect(onChainData.fillInfos.length).toBeTruthy();

    const eventData = getEventData([events[0].subKind])[0];
    const log = events[0].log;
    expect(topics.includes(log.topics[0])).toBeTruthy();

    const parsedLog = eventData.abi.parseLog(log);
    const isBeneficiary = onChainData.fillEventsPartial[0].taker === parsedLog.args.beneficiary;
    expect(isBeneficiary).toBeTruthy();
  });

  it("can add beneficiary to payment-processor-v2-buy-listing-erc721", async () => {
    const onChainData = {
      fillEventsPartial: [],
      fillInfos: [],
      orderInfos: [],
      makerInfos: [],
    } as any;
    const events = [JSON.parse(eventBuyListing721).data];

    expect(subKinds.includes(events[0].subKind)).toBeTruthy();

    const txTrace = await fetchTransactionTrace(events[0].baseEventParams.txHash);
    expect(txTrace?.calls).toBeTruthy();

    await handleEvents(events, onChainData);
    expect(onChainData.fillEventsPartial.length).toBeTruthy();
    expect(onChainData.fillInfos.length).toBeTruthy();

    const eventData = getEventData([events[0].subKind])[0];
    const log = events[0].log;
    expect(topics.includes(log.topics[0])).toBeTruthy();

    const parsedLog = eventData.abi.parseLog(log);
    const isBeneficiary = onChainData.fillEventsPartial[0].taker === parsedLog.args.beneficiary;
    expect(isBeneficiary).toBeTruthy();
  });
});
