"""
Detection d'anomalies sur les contributions (bonus IA du projet CrowdFund DAO).

Lit les evenements Contributed du contrat Crowdfunding et applique 3 regles :
  R1 MONTANTS_REPETITIFS : >= 3 adresses differentes envoient EXACTEMENT le meme montant a une campagne
  R2 ADRESSES_LIEES      : >= 3 contributeurs d'une campagne ont ete finances par la MEME adresse
  R3 PIC_ACTIVITE        : >= 5 contributions a une campagne en moins de 10 minutes
Score de risque = nombre de regles declenchees. Score >= 2 -> proposer un gel (Freeze) a la DAO.

Usage (depuis la racine du projet) :
  python scripts/detect_anomalies.py
  python scripts/detect_anomalies.py --rpc https://ethereum-sepolia-rpc.publicnode.com --from-block 9600000
"""
import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from web3 import Web3

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "frontend" / "src" / "contracts"
REPORT = ROOT / "docs" / "anomalies-report.json"

MIN_GROUP = 3          # R1 et R2 : taille minimale d'un groupe suspect
BURST_WINDOW = 600     # R3 : fenetre de 10 minutes (en secondes)
BURST_MIN = 5          # R3 : nombre de contributions dans la fenetre
MAX_FUNDING_SCAN = 20000  # R2 : nombre maximal de blocs a parcourir


def eth(wei):
    return f"{Web3.from_wei(wei, 'ether').normalize():f}"


def short(addr):
    return f"{addr[:6]}...{addr[-4:]}"


def hexstr(value):
    h = value.hex()
    return h if h.startswith("0x") else "0x" + h


def load_deployment():
    dep = json.loads((CONTRACTS / "deployment.json").read_text(encoding="utf-8"))
    abi = json.loads((CONTRACTS / "Crowdfunding.json").read_text(encoding="utf-8"))["abi"]
    return dep, abi


def fetch_contributions(w3, contract, from_block):
    """Recupere tous les evenements Contributed (par tranches de 5 000 blocs)."""
    topic = hexstr(w3.keccak(text="Contributed(uint256,address,uint256,uint256)"))
    latest = w3.eth.block_number
    logs, start = [], from_block
    while start <= latest:
        end = min(start + 4999, latest)
        logs += w3.eth.get_logs({"fromBlock": start, "toBlock": end,
                                 "address": contract.address, "topics": [topic]})
        start = end + 1

    times, rows = {}, []
    for log in logs:
        args = contract.events.Contributed().process_log(log)["args"]
        bn = log["blockNumber"]
        if bn not in times:
            times[bn] = w3.eth.get_block(bn)["timestamp"]
        rows.append({
            "campaign": int(args["id"]),
            "contributor": args["contributor"],
            "amount": int(args["amount"]),
            "block": bn,
            "time": times[bn],
            "tx": hexstr(log["transactionHash"]),
        })
    return rows


def find_funders(w3, addresses, from_block):
    """Pour chaque contributeur, trouve l'adresse qui lui a envoye de l'ETH en premier."""
    targets = {a.lower() for a in addresses}
    funders = {}
    for bn in range(from_block, w3.eth.block_number + 1):
        block = w3.eth.get_block(bn, full_transactions=True)
        for tx in block["transactions"]:
            to = (tx["to"] or "").lower()
            if to in targets and tx["value"] > 0 and to not in funders:
                funders[to] = tx["from"]
    return funders


def rule_repeated_amounts(rows):
    alerts = []
    groups = defaultdict(lambda: defaultdict(set))
    for r in rows:
        groups[r["campaign"]][r["amount"]].add(r["contributor"])
    for cid, by_amount in groups.items():
        for amount, addrs in by_amount.items():
            if len(addrs) >= MIN_GROUP:
                alerts.append({"campaign": cid, "rule": "MONTANTS_REPETITIFS",
                               "detail": f"{len(addrs)} adresses differentes ont envoye exactement {eth(amount)} ETH",
                               "addresses": sorted(addrs)})
    return alerts


def rule_linked_addresses(rows, funders):
    alerts = []
    groups = defaultdict(lambda: defaultdict(set))
    for r in rows:
        funder = funders.get(r["contributor"].lower())
        if funder:
            groups[r["campaign"]][funder].add(r["contributor"])
    for cid, by_funder in groups.items():
        for funder, addrs in by_funder.items():
            if len(addrs) >= MIN_GROUP:
                alerts.append({"campaign": cid, "rule": "ADRESSES_LIEES",
                               "detail": f"{len(addrs)} contributeurs ont tous ete finances par {short(funder)}",
                               "funder": funder, "addresses": sorted(addrs)})
    return alerts


def rule_activity_burst(rows):
    alerts = []
    by_campaign = defaultdict(list)
    for r in rows:
        by_campaign[r["campaign"]].append(r["time"])
    for cid, times in by_campaign.items():
        times.sort()
        best, left = 0, 0
        for right in range(len(times)):
            while times[right] - times[left] > BURST_WINDOW:
                left += 1
            best = max(best, right - left + 1)
        if best >= BURST_MIN:
            alerts.append({"campaign": cid, "rule": "PIC_ACTIVITE",
                           "detail": f"{best} contributions en moins de {BURST_WINDOW // 60} minutes"})
    return alerts


def main():
    parser = argparse.ArgumentParser(description="Detection d'anomalies CrowdFund DAO")
    parser.add_argument("--rpc", default="http://127.0.0.1:8545", help="URL RPC de la blockchain")
    parser.add_argument("--from-block", type=int, default=0, help="bloc de depart (bloc du deploiement)")
    args = parser.parse_args()

    dep, abi = load_deployment()
    w3 = Web3(Web3.HTTPProvider(args.rpc))
    if not w3.is_connected():
        sys.exit(f"Impossible de joindre la blockchain : {args.rpc}")
    chain_id = w3.eth.chain_id
    if chain_id != dep["chainId"]:
        sys.exit(f"deployment.json correspond au reseau {dep['chainId']}, mais le RPC est sur le reseau {chain_id}.")
    if chain_id != 31337 and args.from_block == 0:
        sys.exit("Sur un reseau public, indique --from-block (le bloc du deploiement, visible sur Etherscan).")

    contract = w3.eth.contract(address=Web3.to_checksum_address(dep["contracts"]["Crowdfunding"]), abi=abi)
    print(f"Reseau {dep['network']} (chainId {chain_id}) - contrat Crowdfunding {contract.address}")

    rows = fetch_contributions(w3, contract, args.from_block)
    print(f"{len(rows)} contribution(s) lue(s) dans {len({r['campaign'] for r in rows})} campagne(s)\n")
    if not rows:
        return

    alerts = rule_repeated_amounts(rows) + rule_activity_burst(rows)
    if w3.eth.block_number - args.from_block <= MAX_FUNDING_SCAN:
        funders = find_funders(w3, {r["contributor"] for r in rows}, args.from_block)
        alerts += rule_linked_addresses(rows, funders)
    else:
        print("(R2 ADRESSES_LIEES ignoree : trop de blocs a parcourir sur ce reseau)\n")

    # Synthese par campagne
    summary = []
    for cid in sorted({r["campaign"] for r in rows}):
        camp_rows = [r for r in rows if r["campaign"] == cid]
        camp_alerts = [a for a in alerts if a["campaign"] == cid]
        score = len({a["rule"] for a in camp_alerts})
        verdict = "SUSPECTE - proposer un gel (Freeze)" if score >= 2 else "A SURVEILLER" if score == 1 else "normale"
        summary.append({"campaign": cid, "contributions": len(camp_rows),
                        "contributors": len({r["contributor"] for r in camp_rows}),
                        "total_eth": eth(sum(r["amount"] for r in camp_rows)),
                        "score": score, "verdict": verdict, "alerts": camp_alerts})

        print(f"Campagne #{cid} : {len(camp_rows)} contributions, {eth(sum(r['amount'] for r in camp_rows))} ETH"
              f" -> score {score}/3 : {verdict}")
        for a in camp_alerts:
            print(f"   [{a['rule']}] {a['detail']}")
            for addr in a.get("addresses", [])[:6]:
                print(f"       - {addr}")
        print()

    REPORT.parent.mkdir(exist_ok=True)
    REPORT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "network": dep["network"], "chain_id": chain_id,
        "rules": {"MIN_GROUP": MIN_GROUP, "BURST_WINDOW_s": BURST_WINDOW, "BURST_MIN": BURST_MIN},
        "campaigns": summary,
    }, indent=2), encoding="utf-8")
    print(f"Rapport ecrit dans {REPORT}")


if __name__ == "__main__":
    main()