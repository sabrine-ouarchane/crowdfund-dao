import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContracts } from "../lib/web3";

const DURATIONS = [
  { label: "1 heure", seconds: 3600 },
  { label: "1 jour", seconds: 86400 },
  { label: "7 jours", seconds: 7 * 86400 },
  { label: "30 jours", seconds: 30 * 86400 },
];

export default function CreateCampaign({ wallet, runTx, busy, paused }) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [duration, setDuration] = useState(DURATIONS[1].seconds);
  const [beneficiary, setBeneficiary] = useState(wallet.address);
  const [formError, setFormError] = useState("");

  // Si on change de compte dans MetaMask, le beneficiaire par defaut suit
  useEffect(() => setBeneficiary(wallet.address), [wallet.address]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!title.trim()) return setFormError("Donne un titre a la campagne.");
    if (!goal || Number(goal) <= 0) return setFormError("L'objectif doit etre superieur a 0.");
    if (!ethers.isAddress(beneficiary)) return setFormError("Adresse du beneficiaire invalide.");

    // PROVISOIRE : sera remplace par le CID IPFS (Pinata) a l'etape suivante
    const ipfsHash = "demo:" + title.trim();

    const ok = await runTx(
      () => getContracts(wallet.signer).crowdfunding.createCampaign(
        ethers.parseEther(goal), duration, beneficiary, ipfsHash
      ),
      `Campagne "${title.trim()}" creee`
    );
    if (ok) { setTitle(""); setGoal(""); }
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Creer une campagne</h2>

      <label>Titre
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Panneaux solaires pour la cooperative" />
      </label>

      <div className="row">
        <label>Objectif (ETH)
          <input type="number" min="0" step="0.01" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="10" />
        </label>
        <label>Duree
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATIONS.map((d) => <option key={d.seconds} value={d.seconds}>{d.label}</option>)}
          </select>
        </label>
      </div>

      <label>Adresse du beneficiaire
        <input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} className="mono" />
      </label>

      {formError && <p className="form-error">{formError}</p>}
      <button className="btn primary" disabled={busy || paused}>
        {paused ? "Plateforme en pause" : "Creer la campagne"}
      </button>
    </form>
  );
}