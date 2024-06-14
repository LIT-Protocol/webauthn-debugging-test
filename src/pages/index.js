import Head from "next/head";
import Image from "next/image";
import { Inter } from "next/font/google";
import styles from "@/styles/Home.module.css";

import * as LitJsSdk from "@lit-protocol/lit-node-client";
import {
  LitAbility,
  LitPKPResource,
  RecapSessionCapabilityObject,
} from "@lit-protocol/auth-helpers";
import { ProviderType, AuthMethodScope } from "@lit-protocol/constants";
import {
  GoogleProvider,
  WebAuthnProvider,
  LitAuthClient,
  isSignInRedirect,
} from "@lit-protocol/lit-auth-client";

const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  async function getNodeClient() {
    const litNodeClient = new LitJsSdk.LitNodeClient({
      litNetwork: "cayenne",
    });
    await litNodeClient.connect();
    return litNodeClient;
  }

  async function createPkpAndLogin(litNodeClient, litAuthClient) {
    if (!litNodeClient || !litAuthClient) {
      console.log("Please wait for lit node client to connect, then try again");
      return;
    }
    litAuthClient.initProvider(ProviderType.WebAuthn);
    const provider = litAuthClient.getProvider(ProviderType.WebAuthn);
    // Register new WebAuthn credential
    const options = await provider.register();

    // Verify registration and mint PKP through relay server
    const txHash = await provider.verifyAndMintPKPThroughRelayer(options, {
      addPkpEthAddressAsPermittedAddress: true,
      sendPkpToItself: true,
    });
    // console.log("txHash");
    // console.log(txHash);
    const res = await provider.relay.pollRequestUntilTerminalState(txHash);
    // Return public key of newly minted PKP
    console.log(res);
    const pkp = {
      tokenId: res.pkpTokenId,
      pkpPublicKey: res.pkpPublicKey,
      ethAddress: res.pkpEthAddress,
    };
    const authMethod = await provider.authenticate();
    return {
      ...authMethod,
      ...pkp,
    };
  }

  async function createSession(litNodeClient, session) {
    const {
      authMethodType,
      accessToken,
      pkpPublicKey,
      // capacityDelegationAuthSig,
    } = session;

    //session key-pair to sign to get session sigs
    const sessionKeyPair = litNodeClient.getSessionKey();

    //SIWE ReCap Object
    const sessionCapabilityObject = new RecapSessionCapabilityObject();
    const litPkpResource = new LitPKPResource(session.tokenId.substr(2));
    sessionCapabilityObject.addCapabilityForResource(
      litPkpResource,
      LitAbility.PKPSigning
    );

    //AuthSig Callback
    // const authNeededCallback = async (params) => {
    //   const response = await litNodeClient.signSessionKey({
    //     sessionKey: sessionKeyPair,
    //     authMethods: [
    //       {
    //         authMethodType: getAuthMethodType(authMethodId),
    //         accessToken:
    //           getAuthMethodType(authMethodId) === AuthMethodType.WebAuthn
    //             ? getPasskeyAuthMethod(accessToken)
    //             : accessToken,
    //       },
    //     ],
    //     domain: config.relayUrl,
    //     pkpPublicKey: pkpPublicKey,
    //     expiration: params.expiration,
    //     resources: params.resources,
    //     chainId: 1,
    //     resourceAbilityRequests: [
    //       {
    //         resource: litPkpResource,
    //         ability: LitAbility.PKPSigning,
    //       },
    //     ],
    //   });
    //   return response.authSig;
    // };

    //Generate session signatures
    const sessionSigs = await litNodeClient.getPkpSessionSigs({
      chain: "ethereum",
      expiration: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
      resourceAbilityRequests: [
        {
          resource: litPkpResource,
          ability: LitAbility.PKPSigning,
        },
      ],
      sessionKey: sessionKeyPair,
      // authNeededCallback,
      //@ts-ignore
      // capacityDelegationAuthSig,
      sessionCapabilityObject,
      pkpPublicKey,
      authMethods: [{ authMethodType, accessToken }],
    });
    return sessionSigs;
  }

  async function go() {
    try {
      //Connect to Lit Nodes
      let litNodeClient = await getNodeClient();
      if (!litNodeClient || !litNodeClient.ready) {
        console.error("lit node client not initialized");
        //@ts-ignore
        // litNodeClient = await initNodeClient();
      }

      const litAuthClient = new LitAuthClient({
        litNodeClient,
        litRelayConfig: {
          relayApiKey: "its_chris",
        },
      });

      // mint PKP and login
      const sessionData = await createPkpAndLogin(litNodeClient, litAuthClient);
      console.log("sessionData created", sessionData);

      //create session
      const session = await createSession(litNodeClient, sessionData);
      console.log(`session generated`);
      //sign message
      let textEncoder = new TextEncoder();
      const toSign = textEncoder.encode("This message is exactly 32 bytes"); // typically this would be a txn to sign
      const result = await litNodeClient.pkpSign({
        pubKey: sessionData.pkpPublicKey,
        chain: "ethereum",
        sessionSigs: session,
        toSign,
      });
      console.log(`signed message`);
      console.log(result);
      const signature = result.signature;
      console.log(`signature ${signature}`);
    } catch (err) {
      console.error("error signing via pkp", {
        err,
      });
    }
  }
  return (
    <>
      <button onClick={go}>Click me</button>
    </>
  );
}
