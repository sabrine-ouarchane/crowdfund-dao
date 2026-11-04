import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContracts, readableError } from "../lib/web3";
import { ipfsConfigured, uploadFile, uploadJSON } from "../lib/ipfs";

const DURATIONS = [
  { label: "1 heure", seconds: 3600 },
  { label: "1 jour", seconds: 86400 },
  { label: "7 jours", seconds: 7 * 86400 },
  { label: "30 jours", seconds: 30 * 86400 },
];

export default function CreateCampaign({ wallet, runTx, busy, paused }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState(null);
  const [goal, setGoal] = useState("");
  const [duration, setDuration] = useState(DURATIONS[1].seconds);
  const [beneficiary, setBeneficiary] = useState(wallet.address);
  const [formError, setFormError] = useState("");
  const [ipfsStatus, setIpfsStatus] = useState("");

  useEffect(() => setBeneficiary(wallet.address), [wallet.address]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!title.trim()) return setFormError("Donne un titre a la campagne.");
    if (!goal || Number(goal) <= 0) return setFormError("L'objectif doit etre superieur a 0.");
    if (!ethers.isAddress(beneficiary)) return setFormError("Adresse du beneficiaire invalide.");
    if (image && image.size > 2 * 1024 * 1024) return setFormError("Image trop lourde (2 Mo maximum).");

    let ipfsHash;
    if (ipfsConfigured) {
      try {
        let imageUri = "";
        if (image) {
          setIpfsStatus("Envoi de l'image sur IPFS…");
          imageUri = "ipfs://" + (await uploadFile(image));
        }
        setIpfsStatus("Envoi des metadonnees sur IPFS…");
        ipfsHash = await uploadJSON(
          {
            name: title.trim(),
            description: description.trim(),
            image: imageUri,
            createdBy: wallet.address,
            createdAt: new Date().toISOString(),
          },
          `campagne-${title.trim()}`
        );
        setIpfsStatus(`Metadonnees sur IPFS (CID ${ipfsHash.slice(0, 12)}…)`);
      } catch (err) {
        setIpfsStatus("");
        return setFormError(readableError(err));
      }
    } else {
      ipfsHash = "demo:" + title.trim();
    }

    const form = e.target;
    const ok = await runTx(
      () => getContracts(wallet.signer).crowdfunding.createCampaign(
        ethers.parseEther(goal), duration, beneficiary, ipfsHash
      ),
      `Campagne "${title.trim()}" creee`
    );
    if (ok) {
      setTitle(""); setDescription(""); setGoal(""); setImage(null);
      form.reset();
    }
    setIpfsStatus("");
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Creer une campagne</h2>
      {!ipfsConfigured && (
        <p className="form-error">Pinata n'est pas configure (frontend/.env) : mode demo sans IPFS.</p>
      )}

      <label>Titre
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Panneaux solaires pour la cooperative" />
      </label>

      <label>Description
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="A quoi serviront les fonds ?" />
      </label>

      <label>Image (optionnelle, 2 Mo max)
        <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files[0] || null)} />
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

      {ipfsStatus && <p className="muted small">{ipfsStatus}</p>}
      {formError && <p className="form-error">{formError}</p>}
      <button className="btn primary" disabled={busy || paused}>
        {paused ? "Plateforme en pause" : "Creer la campagne"}
      </button>
    </form>
  );
}