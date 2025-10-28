jest.mock("@/pubsub/index", () => {
  return {
    PubSub: {
      publish: jest.fn(),
    },
  };
});
import { idb } from "@/common/db";
import { fromBuffer, toBuffer } from "@/common/utils";
import * as Sdk from "@reservoir0x/sdk";
import { Currencies } from "@/models/currencies";
import CurrenciesFetchJob, { IDetails } from "../currencies-fetch-job";
/* eslint-disable @typescript-eslint/no-explicit-any */

describe("postTokensOverrideV1Options tests", () => {
  // todo type this
  const payload = {
    icon: "https://freerangestock.com/sample/118790/currency-and-gold-vector-icon.jpg",
    name: "test-name",
    token: "",
  };

  const token = {
    name: "",
  };

  const currenciesFetchJob = new CurrenciesFetchJob();

  const updateCurrencyTotalValue = async (contract: Buffer) => {
    await idb.query("UPDATE currencies SET total_supply = '0' WHERE contract = $/contract/", {
      contract,
    });
  };

  beforeAll(async () => {
    Sdk.Global.Config.addresses = Sdk.Addresses;
    Sdk.Global.Config.aggregatorSource = "reservoir.tools";

    const currencies = await idb.query("SELECT * FROM currencies where total_supply <> 0 limit 1");
    expect(currencies.length).toEqual(1);
    payload.token = fromBuffer(currencies[0].contract);
    token.name = currencies[0].name;

    await Currencies.updateCurrency(payload.token, {
      image: payload.icon,
      adminImage: payload.icon,
      adminName: payload.name,
    });

    // update the total supply so we can verify the process updates the token
    await updateCurrencyTotalValue(currencies[0].contract);
  });

  it("can handle missing token in DB", async () => {
    const details = {
      name: "something",
      symbol: "TEST",
      decimals: 9,
      totalSupply: 1000,
      metadata: {
        one: "something",
        two: "somethingElse",
      },
    } as IDetails;
    const currency = "0xDoesNotExistInDb";
    const detailsUpdated = await currenciesFetchJob.updateDetailsForAdminOverrides(
      currency,
      details
    );
    expect(details).toEqual(detailsUpdated);
  });

  it("can update token data but not change admin overridden values", async () => {
    let currency = await idb.query("SELECT * FROM currencies where contract = $/contract/", {
      contract: toBuffer(payload.token),
    });
    expect(currency).toBeTruthy();
    expect(currency[0].name).toEqual(payload.name);
    expect(currency[0].metadata.image).toEqual(payload.icon);
    expect(currency[0].metadata.adminImage).toEqual(payload.icon);
    expect(currency[0].metadata.adminName).toEqual(payload.name);
    expect(currency[0].total_supply).toEqual("0");

    await currenciesFetchJob.updateCurrency(payload.token);

    currency = await idb.query("SELECT * FROM currencies where contract = $/contract/", {
      contract: toBuffer(payload.token),
    });
    expect(currency).toBeTruthy();
    expect(currency[0].name).toEqual(payload.name);
    expect(currency[0].metadata.image).toEqual(payload.icon);
    expect(currency[0].metadata.adminImage).toEqual(payload.icon);
    expect(currency[0].metadata.adminName).toEqual(payload.name);
    expect(currency[0].total_supply !== "0").toBeTruthy();
  });

  it("can process the job for override", async () => {
    // reset total supply to 0
    await updateCurrencyTotalValue(toBuffer(payload.token));
    const data = {
      currency: payload.token,
    };
    await currenciesFetchJob.process(data);

    const currency = await idb.query("SELECT * FROM currencies where contract = $/contract/", {
      contract: toBuffer(payload.token),
    });
    expect(currency).toBeTruthy();
    expect(currency[0].name).toEqual(payload.name);
    expect(currency[0].metadata.image).toEqual(payload.icon);
    expect(currency[0].metadata.adminImage).toEqual(payload.icon);
    expect(currency[0].metadata.adminName).toEqual(payload.name);
    expect(currency[0].total_supply !== "0").toBeTruthy();
  });

  it("can process the job for normal token", async () => {
    // revert changes to token
    await Currencies.updateCurrency(payload.token, {
      image: null,
      adminImage: null,
      adminName: null,
    });

    // reset total supply to 0
    await updateCurrencyTotalValue(toBuffer(payload.token));

    const data = {
      currency: payload.token,
    };
    await currenciesFetchJob.process(data);

    const currency = await idb.query("SELECT * FROM currencies where contract = $/contract/", {
      contract: toBuffer(payload.token),
    });
    expect(currency).toBeTruthy();
    expect(currency[0].name).toEqual(token.name);
    expect(currency[0].metadata.image).toBeFalsy();
    expect(currency[0].metadata.adminImage).toBeFalsy();
    expect(currency[0].metadata.adminName).toBeFalsy();
    expect(currency[0].total_supply !== "0").toBeTruthy();
  });
});
