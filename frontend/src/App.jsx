import { useState, useEffect, useCallback } from "react";
import {
  connectWallet, getContracts, switchToExpectedNetwork,
  EXPECTED_CHAIN_ID, ADDRESSES, readableError, shortAddress,
} from "./lib/web3";
import Header from "./components/Header";
import "./App.css";

export default function App() {
  const [wallet, setWallet] = useState(null); // { provider, signer, address, chainId }
  const [info, setInfo] = useState(null);     // soldes, roles, pause
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const wrongNetwork = wallet && wallet.chainId !== EXPECTED_CHAIN_ID;

  // Connexion a MetaMask
  const connect = useCallback(async () => {
    try {
      setError("");
      setWallet(await connectWallet());
    } catch (e) {
      setError(readableError(e));
    }
  }, []);

  // Au chargement : reconnexion silencieuse + ecoute des changements de compte/reseau
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

  // Lecture des informations du compte sur la blockchain
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

  // Bouton d'urgence (Admin)
  const togglePause = async () => {
    try {
      setBusy(true);
      setError("");
      const { crowdfunding } = getContracts(wallet.signer);
      const tx = info.paused ? await crowdfunding.unpause() : await crowdfunding.pause();
      await tx.wait();
      await refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  };

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

        {!window.ethereum && (
          <div className="card">Installe l'extension MetaMask pour utiliser cette dApp.</div>
        )}

        {wallet && !wrongNetwork && (
          <div className="card">
            <h2>Connexion reussie</h2>
            <p className="muted">
              Contrat Crowdfunding : {shortAddress(ADDRESSES.Crowdfunding)} · Gouvernance : {shortAddress(ADDRESSES.Governance)}
            </p>
            <p>La liste des campagnes arrivera ici a l'etape suivante.</p>
          </div>
        )}
      </main>
    </>
  );
}