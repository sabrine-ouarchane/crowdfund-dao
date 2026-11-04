import { useState, useEffect, useCallback } from "react";
import {
  connectWallet, getContracts, switchToExpectedNetwork,
  EXPECTED_CHAIN_ID, readableError,
} from "./lib/web3";
import Header from "./components/Header";
import CreateCampaign from "./components/CreateCampaign";
import CampaignList from "./components/CampaignList";
import GovernancePanel from "./components/GovernancePanel";
import "./App.css";

export default function App() {
  const [wallet, setWallet] = useState(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState("campaigns");

  const wrongNetwork = wallet && wallet.chainId !== EXPECTED_CHAIN_ID;

  const connect = useCallback(async () => {
    try {
      setError("");
      setWallet(await connectWallet());
    } catch (e) {
      setError(readableError(e));
    }
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum.request({ method: "eth_accounts" }).then((accounts) => {
      if (accounts.length > 0) connect();
    });
    const onAccountsChanged = (accounts) => (accounts.length > 0 ? connect() : setWallet(null));
    const onChainChanged = () => connect();
    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener("chainChanged", onChainChanged);
    };
  }, [connect]);

  const refresh = useCallback(async () => {
    if (!wallet || wrongNetwork) {
      setInfo(null);
      return;
    }
    try {
      const { token, crowdfunding, treasury } = getContracts(wallet.provider);
      const pauserRole = await crowdfunding.PAUSER_ROLE();
      const [eth, cfd, isPauser, isGuardian, paused] = await Promise.all([
        wallet.provider.getBalance(wallet.address),
        token.balanceOf(wallet.address),
        crowdfunding.hasRole(pauserRole, wallet.address),
        treasury.isOwner(wallet.address),
        crowdfunding.paused(),
      ]);
      setInfo({ eth, cfd, isPauser, isGuardian, paused });
    } catch (e) {
      setError(readableError(e));
    }
  }, [wallet, wrongNetwork]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fonction unique pour envoyer une transaction et suivre son etat
  const runTx = async (sendTx, successMessage) => {
    try {
      setBusy(true);
      setError("");
      setNotice("Confirme la transaction dans MetaMask…");
      const tx = await sendTx();
      setNotice("Transaction envoyee, attente de la confirmation dans un bloc…");
      await tx.wait();
      setNotice(successMessage);
      setReloadKey((k) => k + 1);
      await refresh();
      return true;
    } catch (e) {
      setNotice("");
      setError(readableError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const togglePause = () => {
    const { crowdfunding } = getContracts(wallet.signer);
    return runTx(
      () => (info.paused ? crowdfunding.unpause() : crowdfunding.pause()),
      info.paused ? "Plateforme reprise" : "Plateforme mise en pause"
    );
  };

  const ready = wallet && !wrongNetwork && info;

  return (
    <>
      <Header
        wallet={wallet}
        info={info}
        wrongNetwork={wrongNetwork}
        busy={busy}
        onConnect={connect}
        onSwitchNetwork={() => switchToExpectedNetwork().catch((e) => setError(readableError(e)))}
        onTogglePause={togglePause}
      />

      <main>
        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}

        {!window.ethereum && (
          <div className="card">Installe l'extension MetaMask pour utiliser cette dApp.</div>
        )}
        {window.ethereum && !wallet && (
          <div className="card">Connecte MetaMask pour voir les campagnes.</div>
        )}

        {ready && (
          <>
            <nav className="tabs">
              <button className={tab === "campaigns" ? "tab active" : "tab"} onClick={() => setTab("campaigns")}>
                Campagnes
              </button>
              <button className={tab === "governance" ? "tab active" : "tab"} onClick={() => setTab("governance")}>
                Gouvernance
              </button>
            </nav>

            {tab === "campaigns" && (
              <div className="layout">
                <section>
                  <h2>Campagnes</h2>
                  <CampaignList wallet={wallet} reloadKey={reloadKey} runTx={runTx} busy={busy} paused={info.paused} />
                </section>
                <aside>
                  <CreateCampaign wallet={wallet} runTx={runTx} busy={busy} paused={info.paused} />
                </aside>
              </div>
            )}

            {tab === "governance" && (
              <GovernancePanel wallet={wallet} reloadKey={reloadKey} runTx={runTx} busy={busy} />
            )}
          </>
        )}
      </main>
    </>
  );
}