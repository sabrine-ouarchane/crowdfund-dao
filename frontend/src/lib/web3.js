import { ethers } from "ethers";
import deployment from "../contracts/deployment.json";
import CFDToken from "../contracts/CFDToken.json";
import MultiSigTreasury from "../contracts/MultiSigTreasury.json";
import Crowdfunding from "../contracts/Crowdfunding.json";
import Governance from "../contracts/Governance.json";

// Le reseau attendu (31337 en local), lu dans le fichier cree par deploy.js
export const EXPECTED_CHAIN_ID = deployment.chainId;
export const ADDRESSES = deployment.contracts;

// Demande a MetaMask l'acces au compte et renvoie tout ce qu'il faut pour travailler
export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("MetaMask n'est pas installe dans ce navigateur.");
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const network = await provider.getNetwork();
  return {
    provider,
    signer,
    address: await signer.getAddress(),
    chainId: Number(network.chainId),
  };
}

// Cree un objet Ethers.js pour chacun des 4 contrats
export function getContracts(signerOrProvider) {
  return {
    token: new ethers.Contract(ADDRESSES.CFDToken, CFDToken.abi, signerOrProvider),
    treasury: new ethers.Contract(ADDRESSES.MultiSigTreasury, MultiSigTreasury.abi, signerOrProvider),
    crowdfunding: new ethers.Contract(ADDRESSES.Crowdfunding, Crowdfunding.abi, signerOrProvider),
    governance: new ethers.Contract(ADDRESSES.Governance, Governance.abi, signerOrProvider),
  };
}

// Demande a MetaMask de passer sur le bon reseau (et de l'ajouter s'il ne le connait pas)
export async function switchToExpectedNetwork() {
  const chainIdHex = "0x" + EXPECTED_CHAIN_ID.toString(16);
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err) {
    if (err.code === 4902 && EXPECTED_CHAIN_ID === 31337) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: chainIdHex,
          chainName: "Hardhat Local",
          rpcUrls: ["http://127.0.0.1:8545"],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        }],
      });
    } else {
      throw err;
    }
  }
}

// Petites fonctions d'affichage
export const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const fmt = (wei, decimals = 4) =>
  Number(ethers.formatEther(wei)).toLocaleString("fr-FR", { maximumFractionDigits: decimals });

// Transforme une erreur technique en message lisible
export function readableError(e) {
  if (e?.code === "ACTION_REJECTED") return "Transaction refusee dans MetaMask.";
  if (e?.code === "BAD_DATA") return "Contrats introuvables : la blockchain a-t-elle ete redemarree ? Relance le deploiement.";
  return e?.reason || e?.shortMessage || e?.message || "Erreur inconnue";
}