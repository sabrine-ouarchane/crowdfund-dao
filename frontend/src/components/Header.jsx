import { shortAddress, fmt } from "../lib/web3";

export default function Header({ wallet, info, wrongNetwork, busy, onConnect, onSwitchNetwork, onTogglePause }) {
  const role = info?.isPauser ? "Admin" : info?.isGuardian ? "Gardien" : "Utilisateur";

  return (
    <header className="header">
      <div className="brand">CrowdFund <span>DAO</span></div>

      {!wallet && (
        <button className="btn primary" onClick={onConnect}>Connecter MetaMask</button>
      )}

      {wallet && wrongNetwork && (
        <div className="warning">
          Mauvais reseau dans MetaMask
          <button className="btn" onClick={onSwitchNetwork}>Passer sur Hardhat Local</button>
        </div>
      )}

      {wallet && !wrongNetwork && info && (
        <div className="account">
          {info.paused && <span className="badge danger">Plateforme en pause</span>}
          <span className="badge">{role}</span>
          <span>{fmt(info.eth)} ETH</span>
          <span>{fmt(info.cfd, 0)} CFD</span>
          <span className="address" title={wallet.address}>{shortAddress(wallet.address)}</span>
          {info.isPauser && (
            <button className="btn" onClick={onTogglePause} disabled={busy}>
              {info.paused ? "Reprendre" : "Pause d'urgence"}
            </button>
          )}
        </div>
      )}
    </header>
  );
}