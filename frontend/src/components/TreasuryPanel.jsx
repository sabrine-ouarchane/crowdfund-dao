import { useEffect, useState } from "react";
import { getContracts, fmt, shortAddress, readableError, ADDRESSES } from "../lib/web3";

export default function TreasuryPanel({ wallet, reloadKey, runTx, busy }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { treasury } = getContracts(wallet.provider);
        const [owners, required, count, isOwner, balance] = await Promise.all([
          treasury.getOwners(),
          treasury.required(),
          treasury.transactionCount(),
          treasury.isOwner(wallet.address),
          wallet.provider.getBalance(ADDRESSES.MultiSigTreasury),
        ]);

        const txs = await Promise.all(
          [...Array(Number(count)).keys()].map(async (id) => {
            const [t, mine] = await Promise.all([
              treasury.transactions(id),
              treasury.isConfirmed(id, wallet.address),
            ]);
            return { id, to: t.to, value: t.value, executed: t.executed, confirmations: Number(t.confirmations), mine };
          })
        );

        if (!cancelled) {
          setData({ owners, required: Number(required), isOwner, balance, txs: txs.reverse() });
          setLoadError("");
        }
      } catch (e) {
        if (!cancelled) setLoadError(readableError(e));
      }
    })();
    return () => { cancelled = true; };
  }, [wallet, reloadKey]);

  if (loadError) return <div className="error">{loadError}</div>;
  if (!data) return <p className="muted">Chargement du coffre…</p>;

  const treasury = () => getContracts(wallet.signer).treasury;
  const me = wallet.address.toLowerCase();

  return (
    <div className="layout">
      <section>
        <h2>Transactions du coffre</h2>
        {data.txs.length === 0 && (
          <div className="card muted">
            Aucune transaction. Elles apparaissent quand un retrait fait depasser 5 ETH cumules sur une campagne.
          </div>
        )}

        <div className="grid">
          {data.txs.map((t) => (
            <div key={t.id} className="card">
              <div className="campaign-head">
                <h3>#{t.id} · {fmt(t.value)} ETH vers {shortAddress(t.to)}</h3>
                <span className={`status ${t.executed ? "success" : "queued"}`}>
                  {t.executed ? "Payee" : "En attente"}
                </span>
              </div>

              <div className="sigs">
                {[...Array(data.required).keys()].map((i) => (
                  <span key={i} className={i < t.confirmations ? "sig on" : "sig"} />
                ))}
                <span className="small">{t.confirmations} / {data.required} signatures</span>
              </div>

              {!t.executed && data.isOwner && (
                <div className="actions">
                  {!t.mine && (
                    <button className="btn primary" disabled={busy}
                      onClick={() => runTx(() => treasury().confirm(t.id), `Transaction #${t.id} signee`)}>
                      Signer
                    </button>
                  )}
                  {t.mine && (
                    <button className="btn" disabled={busy}
                      onClick={() => runTx(() => treasury().revoke(t.id), "Signature retiree")}>
                      Retirer ma signature
                    </button>
                  )}
                  {t.confirmations >= data.required && (
                    <button className="btn ok-btn" disabled={busy}
                      onClick={() => runTx(() => treasury().execute(t.id), `${fmt(t.value)} ETH envoyes au beneficiaire`)}>
                      Executer le paiement
                    </button>
                  )}
                </div>
              )}
              {!t.executed && !data.isOwner && (
                <p className="muted small">Seuls les gardiens peuvent signer cette transaction.</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <aside className="card">
        <h2>Coffre multisig</h2>
        <p>Regle : <strong>{data.required} signatures sur {data.owners.length}</strong></p>
        <p>Solde du coffre : <strong>{fmt(data.balance)} ETH</strong></p>
        <p className="muted small">Gardiens :</p>
        <ul className="owners">
          {data.owners.map((o) => (
            <li key={o} className="mono">{shortAddress(o)}{o.toLowerCase() === me && " (toi)"}</li>
          ))}
        </ul>
        <p className="muted small">
          Le destinataire est fixe par Crowdfunding : les gardiens peuvent seulement approuver ou bloquer, jamais rediriger les fonds.
        </p>
      </aside>
    </div>
  );
}