// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CFDToken} from "./CFDToken.sol";
import {Crowdfunding} from "./Crowdfunding.sol";

/**
 * @title  Governance - DAO des detenteurs de CFD
 * @notice Vote pondere par les CFD detenus au SNAPSHOT (bloc precedant la proposition),
 *         quorum 20 %, majorite simple, timelock, puis execution par n'importe qui.
 */
contract Governance {

    enum ProposalType { Release, Freeze }
    enum ProposalState { Active, Defeated, Queued, Executable, Executed, Expired }

    struct Proposal {
        ProposalType ptype;
        uint256 campaignId;
        uint256 amount;          // pour Release uniquement
        address proposer;
        uint256 snapshotBlock;   // la "photo" des voix
        uint256 voteEnd;         // fin du vote (timestamp)
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        string description;
    }

    uint256 public constant QUORUM_PERCENT = 20;
    uint256 public constant PROPOSAL_THRESHOLD = 100 * 1e18;  // 100 CFD
    uint256 public constant GRACE_PERIOD = 7 days;
    uint256 public constant MIN_PERIOD = 1 minutes;
    uint256 public constant MAX_PERIOD = 30 days;

    CFDToken public immutable token;
    Crowdfunding public immutable crowdfunding;
    uint256 public immutable votingPeriod;
    uint256 public immutable executionDelay;

    Proposal[] private proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(uint256 indexed id, address indexed proposer, ProposalType ptype,
        uint256 campaignId, uint256 amount, uint256 snapshotBlock, uint256 voteEnd, string description);
    event VoteCast(uint256 indexed id, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed id);
        constructor(CFDToken _token, Crowdfunding _crowdfunding, uint256 _votingPeriod, uint256 _executionDelay) {
        require(address(_token) != address(0), "GOV: token nul");
        require(address(_crowdfunding) != address(0), "GOV: crowdfunding nul");
        require(_votingPeriod >= MIN_PERIOD && _votingPeriod <= MAX_PERIOD, "GOV: periode de vote invalide");
        require(_executionDelay >= MIN_PERIOD && _executionDelay <= MAX_PERIOD, "GOV: delai invalide");
        token = _token;
        crowdfunding = _crowdfunding;
        votingPeriod = _votingPeriod;
        executionDelay = _executionDelay;
    }

    function propose(ProposalType ptype, uint256 campaignId, uint256 amount, string calldata description)
        external
        returns (uint256 id)
    {
        require(campaignId < crowdfunding.campaignCount(), "GOV: campagne inexistante");
        if (ptype == ProposalType.Release) {
            require(amount > 0, "GOV: montant nul");
        } else {
            require(amount == 0, "GOV: pas de montant pour un gel");
        }

        // SNAPSHOT : bloc precedent -> des CFD obtenus dans ce bloc ne comptent pas
        uint256 snapshotBlock = block.number - 1;

        // Le beneficiaire peut demander SON argent ; sinon il faut 100 CFD au snapshot
        bool isBeneficiary = ptype == ProposalType.Release
            && crowdfunding.getCampaign(campaignId).beneficiary == msg.sender;
        require(
            isBeneficiary || token.getPastVotes(msg.sender, snapshotBlock) >= PROPOSAL_THRESHOLD,
            "GOV: pas assez de CFD pour proposer"
        );
        require(token.getPastTotalSupply(snapshotBlock) > 0, "GOV: aucun votant");

        id = proposals.length;
        proposals.push(Proposal({
            ptype: ptype,
            campaignId: campaignId,
            amount: amount,
            proposer: msg.sender,
            snapshotBlock: snapshotBlock,
            voteEnd: block.timestamp + votingPeriod,
            forVotes: 0,
            againstVotes: 0,
            executed: false,
            description: description
        }));
        emit ProposalCreated(id, msg.sender, ptype, campaignId, amount, snapshotBlock,
            block.timestamp + votingPeriod, description);
    }

    function vote(uint256 id, bool support) external {
        require(id < proposals.length, "GOV: proposition inexistante");
        Proposal storage p = proposals[id];
        require(block.timestamp < p.voteEnd, "GOV: vote termine");
        require(!hasVoted[id][msg.sender], "GOV: deja vote");

        // Le poids du vote = CFD detenus AU SNAPSHOT, pas maintenant
        uint256 weight = token.getPastVotes(msg.sender, p.snapshotBlock);
        require(weight > 0, "GOV: aucune voix au snapshot");

        hasVoted[id][msg.sender] = true;
        if (support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }
        emit VoteCast(id, msg.sender, support, weight);
    }
        function state(uint256 id) public view returns (ProposalState) {
        require(id < proposals.length, "GOV: proposition inexistante");
        Proposal storage p = proposals[id];

        if (p.executed) return ProposalState.Executed;
        if (block.timestamp < p.voteEnd) return ProposalState.Active;

        uint256 quorumVotes = (token.getPastTotalSupply(p.snapshotBlock) * QUORUM_PERCENT) / 100;
        bool quorumReached = (p.forVotes + p.againstVotes) >= quorumVotes;
        if (!quorumReached || p.forVotes <= p.againstVotes) return ProposalState.Defeated;

        uint256 eta = p.voteEnd + executionDelay;   // heure a partir de laquelle on peut executer
        if (block.timestamp < eta) return ProposalState.Queued;
        if (block.timestamp <= eta + GRACE_PERIOD) return ProposalState.Executable;
        return ProposalState.Expired;
    }

    function execute(uint256 id) external {
        // CHECKS
        require(state(id) == ProposalState.Executable, "GOV: non executable");
        Proposal storage p = proposals[id];
        // EFFECTS (l'evenement fait partie des effets : emis AVANT l'appel externe)
        p.executed = true;
        emit ProposalExecuted(id);
        // INTERACTIONS
        if (p.ptype == ProposalType.Release) {
            crowdfunding.approveRelease(p.campaignId, p.amount);
        } else {
            crowdfunding.freezeCampaign(p.campaignId);
        }
    }

    function proposalCount() external view returns (uint256) {
        return proposals.length;
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        require(id < proposals.length, "GOV: proposition inexistante");
        return proposals[id];
    }
}