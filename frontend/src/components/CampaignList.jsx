import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContracts, shortAddress, fmt, readableError } from "../lib/web3";
import { fetchMetadata, ipfsToHttp } from "../lib/ipfs";

const STATUS = ["En cours", "Reussie", "Echouee", "Annulee"];
const STATUS_CLASS = ["active", "success", "failed", "cancelled"];

export function campaignTitle(hash) {
  return hash.startsWith("demo:") ? hash.slice(5) : `IPFS ${hash.slice(0, 10)}…`;
}

function timeLeft(deadline, now) {
  const s = Number(deadline) - now;
  if (s <= 0) return "Date limite passee";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} j ${h} h restants`;
  if (h > 0) return `${h} h ${m} min restantes`;
  return `${m} min restantes`;
}

export default function CampaignList({ wallet, reloadKey, runTx, busy, paused }) {
  const [campaigns, setCampaigns] = useState([]);
  const [now, setNow] = useState(0);
  const [amounts, setAmounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [meta, setMeta] = useState({});

  // Lecture de toutes les campagnes sur la blockchain
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { crowdfunding } = getContracts(wallet.provider);
        const count = Number(await crowdfunding.campaignCount());

        const list = await Promise.all(
          [...Array(count).keys()].map(async (id) => {
            const [c, mine] = await Promise.all([
              crowdfunding.getCampaign(id),
              crowdfunding.contributions(id, wallet.address),
            ]);
            return {
              id,
              beneficiary: c.beneficiary,
              goal: c.goal,
              deadline: c.deadline,
              raised: c.raised,
              approved: c.approved,
              withdrawn: c.withdrawn,
              status: Number(c.status),
              ipfsHash: c.ipfsHash,
              mine,
            };
          })
        );

        const block = await wallet.provider.getBlock("latest");
        if (!cancelled) {
          setCampaigns(list.reverse());
          setNow(block.timestamp);
          setLoadError("");
        }
      } catch (e) {
        if (!cancelled) setLoadError(readableError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [wallet, reloadKey]);

  // Lecture des metadonnees IPFS (titre, description, image) de chaque campagne
  useEffect(() => {
    campaigns.forEach((c) => {
      if (c.ipfsHash.startsWith("demo:") || meta[c.ipfsHash]) return;
      fetchMetadata(c.ipfsHash)
        .then((m) => setMeta((prev) => ({ ...prev, [c.ipfsHash]: m })))
        .catch(() => setMeta((prev) => ({ ...prev, [c.ipfsHash]: { name: "Metadonnees IPFS indisponibles" } })));
    });
  }, [campaigns]); // eslint-disable-line react-hooks/exhaustive-deps

  const cf = () => getContracts(wallet.signer).crowdfunding;
  const me = wallet.address.toLowerCase();

  const contribute = async (id) => {
    const value = amounts[id];
    if (!value || Number(value) <= 0) return;
    const ok = await runTx(
      () => cf().contribute(id, { value: ethers.parseEther(value) }),
      `Contribution de ${value} ETH envoyee : tu as recu ${Number(value) * 1000} CFD`
    );
    if (ok) setAmounts((a) => ({ ...a, [id]: "" }));
  };

  if (loading && campaigns.length === 0) return <p className="muted">Chargement des campagnes…</p>;
  if (loadError) return <div className="error">{loadError}</div>;
  if (campaigns.length === 0) return <div className="card muted">Aucune campagne pour l'instant. Cree la premiere !</div>;

  return (
    <div className="grid">
      {campaigns.map((c) => {
        const m = meta[c.ipfsHash];
        const pct = c.goal > 0n ? Number((c.raised * 100n) / c.goal) : 0;
        const ended = now >= Number(c.deadline);
        const isActive = c.status === 0;
        const available = c.approved - c.withdrawn;
        const isBeneficiary = c.beneficiary.toLowerCase() === me;

        const canContribute = isActive && !ended;
        const canFinalize = isActive && ended;
        const canRefund = (c.status === 2 || c.status === 3) && c.mine > 0n;
        const canWithdraw = isBeneficiary && (c.status === 0 || c.status === 1) && available > 0n;

        return (
          <div key={c.id} className="card campaign">
            <div className="campaign-head">
              <h3>#{c.id} · {m?.name || campaignTitle(c.ipfsHash)}</h3>
              <span className={`status ${STATUS_CLASS[c.status]}`}>{STATUS[c.status]}</span>
            </div>

            {m?.image && <img className="cover" src={ipfsToHttp(m.image)} alt="" />}
            {m?.description && <p>{m.description}</p>}
            {!c.ipfsHash.startsWith("demo:") && (
              <p className="muted small">
                CID IPFS :{" "}
                <a href={ipfsToHttp(c.ipfsHash)} target="_blank" rel="noreferrer">{c.ipfsHash.slice(0, 14)}…</a>
              </p>
            )}

            <div className="progress"><div style={{ width: `${Math.min(pct, 100)}%` }} /></div>
            <p><strong>{fmt(c.raised)} ETH</strong> sur {fmt(c.goal)} ETH ({pct} %)</p>

            <p className="muted">
              Beneficiaire : {shortAddress(c.beneficiary)}{isBeneficiary && " (toi)"} ·{" "}
              {isActive ? timeLeft(c.deadline, now) : "Cloturee"}
            </p>
            {c.mine > 0n && <p className="muted">Ta contribution : {fmt(c.mine)} ETH</p>}
            {c.approved > 0n && (
              <p className="muted">Autorise par la DAO : {fmt(c.approved)} ETH · deja retire : {fmt(c.withdrawn)} ETH</p>
            )}

            <div className="actions">
              {canContribute && (
                <>
                  <input
                    type="number" min="0" step="any" placeholder="ETH"
                    value={amounts[c.id] || ""}
                    onChange={(e) => setAmounts((a) => ({ ...a, [c.id]: e.target.value }))}
                  />
                  <button className="btn primary" disabled={busy || paused} onClick={() => contribute(c.id)}>
                    Contribuer
                  </button>
                </>
              )}
              {canFinalize && (
                <button className="btn" disabled={busy}
                  onClick={() => runTx(() => cf().finalize(c.id), `Campagne #${c.id} finalisee`)}>
                  Finaliser
                </button>
              )}
              {canRefund && (
                <button className="btn" disabled={busy || paused}
                                  onClick={() => runTx(() => cf().refund(c.id), "Remboursement effectue, tes CFD ont ete brules")}>
                  Me faire rembourser
                </button>
              )}
              {canWithdraw && (
                <button className="btn primary" disabled={busy || paused}
                  onClick={() => runTx(() => cf().withdrawFunds(c.id, available), `${fmt(available)} ETH retires`)}>
                  Retirer {fmt(available)} ETH
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}