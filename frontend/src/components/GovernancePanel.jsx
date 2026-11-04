import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContracts, fmt, shortAddress, readableError } from "../lib/web3";
import { campaignTitle } from "./CampaignList";

const STATE_LABEL = ["En cours", "Rejetee", "En attente (timelock)", "Executable", "Executee", "Expiree"];
const STATE_CLASS = ["active", "failed", "queued", "success", "done", "cancelled"];
const TYPE_LABEL = ["Debloquer des fonds", "Geler la campagne"];
const PROPOSAL_THRESHOLD = ethers.parseEther("100"); // 100 CFD, comme dans Governance.sol

function duration(s) {
  if (s <= 0) return "0 s";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d} j ${h} h`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${sec} s`;
  return `${sec} s`;
}

export default function GovernancePanel({ wallet, reloadKey, runTx, busy }) {
  const [proposals, setProposals] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [params, setParams] = useState(null);
  const [now, setNow] = useState(0);
  const [myVotes, setMyVotes] = useState(0n);
  const [loadError, setLoadError] = useState("");

  // Champs du formulaire
  const [ptype, setPtype] = useState(0);
  const [campaignId, setCampaignId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { governance, crowdfunding, token } = getContracts(wallet.provider);
        const [count, cCount, votingPeriod, executionDelay, grace, quorumPct, block, votesNow] =
          await Promise.all([
            governance.proposalCount(),
            crowdfunding.campaignCount(),
            governance.votingPeriod(),
            governance.executionDelay(),
            governance.GRACE_PERIOD(),
            governance.QUORUM_PERCENT(),
            wallet.provider.getBlock("latest"),
            token.getVotes(wallet.address),
          ]);

        const camps = await Promise.all(
          [...Array(Number(cCount)).keys()].map(async (id) => {
            const c = await crowdfunding.getCampaign(id);
            return { id, title: campaignTitle(c.ipfsHash), status: Number(c.status), beneficiary: c.beneficiary };
          })
        );

        const props = await Promise.all(
          [...Array(Number(count)).keys()].map(async (id) => {
            const p = await governance.getProposal(id);
            const [state, voted, weight, supply] = await Promise.all([
              governance.state(id),
              governance.hasVoted(id, wallet.address),
              token.getPastVotes(wallet.address, p.snapshotBlock),   // MON poids AU SNAPSHOT
              token.getPastTotalSupply(p.snapshotBlock),             // total de CFD au snapshot
            ]);
            return {
              id,
              ptype: Number(p.ptype),
              campaignId: Number(p.campaignId),
              amount: p.amount,
              proposer: p.proposer,
              snapshotBlock: Number(p.snapshotBlock),
              voteEnd: Number(p.voteEnd),
              forVotes: p.forVotes,
              againstVotes: p.againstVotes,
              description: p.description,
              state: Number(state),
              voted,
              weight,
              quorum: (supply * quorumPct) / 100n,
            };
          })
        );

        if (!cancelled) {
          setCampaigns(camps);
          setProposals(props.reverse());
          setParams({ votingPeriod: Number(votingPeriod), executionDelay: Number(executionDelay), grace: Number(grace) });
          setNow(block.timestamp);
          setMyVotes(votesNow);
          setLoadError("");
        }
      } catch (e) {
        if (!cancelled) setLoadError(readableError(e));
      }
    })();
    return () => { cancelled = true; };
  }, [wallet, reloadKey]);
    const eligibleCampaigns = campaigns.filter((c) => c.status === 0 || c.status === 1);
  const selected = campaigns.find((c) => String(c.id) === campaignId);
  const isBeneficiary = selected && selected.beneficiary.toLowerCase() === wallet.address.toLowerCase();
  const canPropose = (ptype === 0 && isBeneficiary) || myVotes >= PROPOSAL_THRESHOLD;

  const submit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (campaignId === "") return setFormError("Choisis une campagne.");
    if (ptype === 0 && (!amount || Number(amount) <= 0)) return setFormError("Indique le montant a debloquer.");
    if (!description.trim()) return setFormError("Ajoute une description.");

    const value = ptype === 0 ? ethers.parseEther(amount) : 0n;
    const ok = await runTx(
      () => getContracts(wallet.signer).governance.propose(ptype, Number(campaignId), value, description.trim()),
      "Proposition creee : le vote est ouvert"
    );
    if (ok) { setAmount(""); setDescription(""); }
  };

  const vote = (id, support) =>
    runTx(() => getContracts(wallet.signer).governance.vote(id, support), support ? "Vote OUI enregistre" : "Vote NON enregistre");

  const execute = (id) =>
    runTx(() => getContracts(wallet.signer).governance.execute(id), "Proposition executee : la decision est appliquee");

  if (loadError) return <div className="error">{loadError}</div>;
  if (!params) return <p className="muted">Chargement de la gouvernance…</p>;

  const form = (
    <form className="card form" onSubmit={submit}>
      <h2>Nouvelle proposition</h2>
      <p className="muted small">
        Vote : {duration(params.votingPeriod)} · Timelock : {duration(params.executionDelay)} · Quorum : 20 % · Tes voix actuelles : {fmt(myVotes, 0)} CFD
      </p>

      <label>Type
        <select value={ptype} onChange={(e) => setPtype(Number(e.target.value))}>
          <option value={0}>{TYPE_LABEL[0]}</option>
          <option value={1}>{TYPE_LABEL[1]}</option>
        </select>
      </label>

      <label>Campagne
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">— choisir —</option>
          {eligibleCampaigns.map((c) => <option key={c.id} value={c.id}>#{c.id} · {c.title}</option>)}
        </select>
      </label>

      {ptype === 0 && (
        <label>Montant a debloquer (ETH)
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      )}

      <label>Description
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Achat anticipe des panneaux solaires" />
      </label>

      {!canPropose && campaignId !== "" && (
        <p className="form-error">
          Il faut etre le beneficiaire (pour un deblocage) ou detenir au moins 100 CFD pour proposer.
        </p>
      )}
      {formError && <p className="form-error">{formError}</p>}
      <button className="btn primary" disabled={busy || !canPropose}>Soumettre au vote</button>
    </form>
  );
    return (
    <div className="layout">
      <section>
        <h2>Propositions</h2>
        {proposals.length === 0 && <div className="card muted">Aucune proposition pour l'instant.</div>}

        <div className="grid">
          {proposals.map((p) => {
            const camp = campaigns[p.campaignId];
            const total = p.forVotes + p.againstVotes;
            const forPct = total > 0n ? Number((p.forVotes * 100n) / total) : 0;
            const againstPct = total > 0n ? 100 - forPct : 0;
            const quorumPct = p.quorum > 0n ? Math.min(100, Number((total * 100n) / p.quorum)) : 0;
            const eta = p.voteEnd + params.executionDelay;

            let timing = "";
            if (p.state === 0) timing = `Fin du vote dans ${duration(p.voteEnd - now)}`;
            if (p.state === 2) timing = `Executable dans ${duration(eta - now)}`;
            if (p.state === 3) timing = `Expire dans ${duration(eta + params.grace - now)}`;

            return (
              <div key={p.id} className="card proposal">
                <div className="campaign-head">
                  <h3>#{p.id} · {TYPE_LABEL[p.ptype]} — campagne #{p.campaignId} {camp ? `(${camp.title})` : ""}</h3>
                  <span className={`status ${STATE_CLASS[p.state]}`}>{STATE_LABEL[p.state]}</span>
                </div>

                <p>{p.description}</p>
                {p.ptype === 0 && <p><strong>Montant demande : {fmt(p.amount)} ETH</strong></p>}
                <p className="muted small">
                  Propose par {shortAddress(p.proposer)} · snapshot au bloc #{p.snapshotBlock}{timing && ` · ${timing}`}
                </p>

                <div className="votes">
                  <div className="vote-bar">
                    <div className="for" style={{ width: `${forPct}%` }} />
                    <div className="against" style={{ width: `${againstPct}%` }} />
                  </div>
                  <p className="small">
                    <span className="ok">OUI {fmt(p.forVotes, 0)} CFD</span> ·{" "}
                    <span className="ko">NON {fmt(p.againstVotes, 0)} CFD</span>
                  </p>
                  <p className="muted small">
                    Participation : {fmt(total, 0)} / quorum {fmt(p.quorum, 0)} CFD ({quorumPct} %)
                  </p>
                </div>

                <div className="actions">
                  {p.state === 0 && !p.voted && p.weight > 0n && (
                    <>
                      <button className="btn ok-btn" disabled={busy} onClick={() => vote(p.id, true)}>
                        Voter OUI ({fmt(p.weight, 0)} CFD)
                      </button>
                      <button className="btn ko-btn" disabled={busy} onClick={() => vote(p.id, false)}>
                        Voter NON
                      </button>
                    </>
                  )}
                  {p.state === 0 && !p.voted && p.weight === 0n && (
                    <p className="snapshot-note">
                      Tu n'avais aucun CFD au bloc #{p.snapshotBlock} (snapshot) : tu ne peux pas voter sur cette proposition.
                      Les CFD obtenus apres sa creation ne comptent pas.
                    </p>
                  )}
                  {p.voted && <p className="muted small">Tu as deja vote sur cette proposition.</p>}
                  {p.state === 3 && (
                    <button className="btn primary" disabled={busy} onClick={() => execute(p.id)}>Executer</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <aside>{form}</aside>
    </div>
  );
}