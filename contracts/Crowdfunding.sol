// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CFDToken} from "./CFDToken.sol";
import {MultiSigTreasury} from "./MultiSigTreasury.sol";

/**
 * @title  Crowdfunding - coeur de la plateforme (campagnes, contributions, fonds)
 * @notice Les fonds ne sortent qu'apres validation par la gouvernance ;
 *         au-dela du seuil cumule, ils passent par le multisig 2-sur-3.
 */
contract Crowdfunding is AccessControl, ReentrancyGuard, Pausable {

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    uint256 public constant RATE = 1000;                  // 1 ETH = 1 000 CFD
    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 90 days;
    uint256 public constant MULTISIG_THRESHOLD = 5 ether; // seuil cumule par campagne

    enum Status { Active, Successful, Failed, Cancelled }

    struct Campaign {
        address creator;
        address beneficiary;
        uint256 goal;
        uint256 deadline;
        uint256 raised;
        uint256 approved;   // montant autorise par la gouvernance
        uint256 withdrawn;  // montant deja retire
        Status status;
        string ipfsHash;    // CID des metadonnees sur IPFS
    }

    CFDToken public immutable token;
    MultiSigTreasury public immutable treasury;

    Campaign[] private campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;

    event CampaignCreated(uint256 indexed id, address indexed creator, address beneficiary, uint256 goal, uint256 deadline, string ipfsHash);
    event Contributed(uint256 indexed id, address indexed contributor, uint256 amount, uint256 tokens);
    event Finalized(uint256 indexed id, Status status);
    event Refunded(uint256 indexed id, address indexed contributor, uint256 amount);
    event ReleaseApproved(uint256 indexed id, uint256 amount);
    event CampaignFrozen(uint256 indexed id);
    event FundsWithdrawn(uint256 indexed id, address indexed beneficiary, uint256 amount, bool viaMultisig, uint256 txId);
        modifier campaignExists(uint256 id) {
        require(id < campaigns.length, "CF: campagne inexistante");
        _;
    }

    constructor(address admin, CFDToken _token, MultiSigTreasury _treasury) {
        require(admin != address(0), "CF: admin nul");
        require(address(_token) != address(0), "CF: token nul");
        require(address(_treasury) != address(0), "CF: treasury nul");
        token = _token;
        treasury = _treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function createCampaign(
        uint256 goal,
        uint256 duration,
        address beneficiary,
        string calldata ipfsHash
    ) external whenNotPaused returns (uint256 id) {
        require(goal > 0, "CF: objectif nul");
        require(duration >= MIN_DURATION && duration <= MAX_DURATION, "CF: duree invalide");
        require(beneficiary != address(0), "CF: beneficiaire nul");
        require(bytes(ipfsHash).length > 0, "CF: hash IPFS vide");

        id = campaigns.length;
        campaigns.push(Campaign({
            creator: msg.sender,
            beneficiary: beneficiary,
            goal: goal,
            deadline: block.timestamp + duration,
            raised: 0,
            approved: 0,
            withdrawn: 0,
            status: Status.Active,
            ipfsHash: ipfsHash
        }));
        emit CampaignCreated(id, msg.sender, beneficiary, goal, block.timestamp + duration, ipfsHash);
    }

    function contribute(uint256 id) external payable nonReentrant whenNotPaused campaignExists(id) {
        Campaign storage c = campaigns[id];
        require(c.status == Status.Active, "CF: campagne non active");
        require(block.timestamp < c.deadline, "CF: campagne terminee");
        require(msg.value > 0, "CF: montant nul");

        contributions[id][msg.sender] += msg.value;
        c.raised += msg.value;

        uint256 tokens = msg.value * RATE;
        token.mint(msg.sender, tokens);
        emit Contributed(id, msg.sender, msg.value, tokens);
    }
        function finalize(uint256 id) external campaignExists(id) {
        Campaign storage c = campaigns[id];
        require(c.status == Status.Active, "CF: deja finalisee");
        require(block.timestamp >= c.deadline, "CF: pas encore terminee");

        c.status = (c.raised >= c.goal) ? Status.Successful : Status.Failed;
        emit Finalized(id, c.status);
    }

    function refund(uint256 id) external nonReentrant whenNotPaused campaignExists(id) {
        Campaign storage c = campaigns[id];
        // CHECKS
        require(c.status == Status.Failed || c.status == Status.Cancelled, "CF: remboursement impossible");
        uint256 contributed = contributions[id][msg.sender];
        require(contributed > 0, "CF: rien a rembourser");

        // Remboursement proportionnel a ce qui reste dans la campagne
        uint256 amount = (contributed * (c.raised - c.withdrawn)) / c.raised;

        // EFFECTS
        contributions[id][msg.sender] = 0;
        token.burn(msg.sender, contributed * RATE);

        // INTERACTIONS
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "CF: transfert echoue");
        emit Refunded(id, msg.sender, amount);
    }
        function approveRelease(uint256 id, uint256 amount) external onlyRole(GOVERNANCE_ROLE) campaignExists(id) {
        Campaign storage c = campaigns[id];
        require(c.status == Status.Active || c.status == Status.Successful, "CF: statut invalide");
        require(amount > 0, "CF: montant nul");
        require(c.approved + amount <= c.raised, "CF: depasse les fonds collectes");

        c.approved += amount;
        emit ReleaseApproved(id, amount);
    }

    function freezeCampaign(uint256 id) external onlyRole(GOVERNANCE_ROLE) campaignExists(id) {
        Campaign storage c = campaigns[id];
        require(c.status == Status.Active || c.status == Status.Successful, "CF: statut invalide");
        c.status = Status.Cancelled;
        emit CampaignFrozen(id);
    }

    function withdrawFunds(uint256 id, uint256 amount) external nonReentrant whenNotPaused campaignExists(id) {
        Campaign storage c = campaigns[id];
        // CHECKS
        require(msg.sender == c.beneficiary, "CF: seul le beneficiaire");
        require(c.status == Status.Active || c.status == Status.Successful, "CF: statut invalide");
        require(amount > 0 && amount <= c.approved - c.withdrawn, "CF: montant non autorise");

        // EFFECTS
        bool viaMultisig = (c.withdrawn + amount > MULTISIG_THRESHOLD);
        c.withdrawn += amount;

        // INTERACTIONS
        if (viaMultisig) {
            uint256 txId = treasury.deposit{value: amount}(c.beneficiary);
            emit FundsWithdrawn(id, c.beneficiary, amount, true, txId);
        } else {
            (bool ok, ) = payable(c.beneficiary).call{value: amount}("");
            require(ok, "CF: transfert echoue");
            emit FundsWithdrawn(id, c.beneficiary, amount, false, 0);
        }
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function campaignCount() external view returns (uint256) {
        return campaigns.length;
    }

    function getCampaign(uint256 id) external view campaignExists(id) returns (Campaign memory) {
        return campaigns[id];
    }
}