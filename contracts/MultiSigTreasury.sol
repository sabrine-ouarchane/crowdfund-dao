// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  MultiSigTreasury - coffre 2-sur-3 pour les retraits au-dela du seuil
 * @notice Le destinataire est fixe par Crowdfunding : les signataires peuvent
 *         seulement approuver ou bloquer, jamais rediriger les fonds.
 */
contract MultiSigTreasury is ReentrancyGuard {

    struct Transaction {
        address to;             // beneficiaire (fixe par Crowdfunding)
        uint256 value;          // montant en wei
        bool executed;          // deja payee ?
        uint256 confirmations;  // nombre de signatures
    }

    address[] public owners;                 // les gardiens
    mapping(address => bool) public isOwner; // acces rapide : est-ce un gardien ?
    uint256 public immutable required;       // signatures necessaires (2)

    address public core;                     // adresse du contrat Crowdfunding
    address private immutable deployer;      // qui a deploye le coffre

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public isConfirmed;

    event CoreSet(address core);
    event Deposited(uint256 indexed txId, address indexed to, uint256 value);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Revoked(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId, address indexed to, uint256 value);
        modifier onlyOwner() {
        require(isOwner[msg.sender], "MS: pas signataire");
        _;
    }

    modifier txExists(uint256 id) {
        require(id < transactions.length, "MS: tx inexistante");
        _;
    }

    modifier notExecuted(uint256 id) {
        require(!transactions[id].executed, "MS: deja executee");
        _;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length >= 3, "MS: au moins 3 signataires");
        require(_required >= 2 && _required <= _owners.length, "MS: seuil invalide");

        for (uint256 i = 0; i < _owners.length; i++) {
            address o = _owners[i];
            require(o != address(0), "MS: adresse nulle");
            require(!isOwner[o], "MS: signataire en double");
            isOwner[o] = true;
            owners.push(o);
        }
        required = _required;
        deployer = msg.sender;
    }

    /// A appeler une seule fois, juste apres le deploiement de Crowdfunding
    function setCore(address _core) external {
        require(msg.sender == deployer, "MS: seul le deployeur");
        require(core == address(0), "MS: core deja defini");
        require(_core != address(0), "MS: adresse nulle");
        core = _core;
        emit CoreSet(_core);
    }
        /// Appele par Crowdfunding : cree une transaction en attente vers le beneficiaire
    function deposit(address to) external payable returns (uint256 txId) {
        require(msg.sender == core, "MS: seul Crowdfunding");
        require(to != address(0), "MS: adresse nulle");
        require(msg.value > 0, "MS: montant nul");

        txId = transactions.length;
        transactions.push(Transaction({to: to, value: msg.value, executed: false, confirmations: 0}));
        emit Deposited(txId, to, msg.value);
    }

    function confirm(uint256 id) external onlyOwner txExists(id) notExecuted(id) {
        require(!isConfirmed[id][msg.sender], "MS: deja confirme");
        isConfirmed[id][msg.sender] = true;
        transactions[id].confirmations += 1;
        emit Confirmed(id, msg.sender);
    }

    function revoke(uint256 id) external onlyOwner txExists(id) notExecuted(id) {
        require(isConfirmed[id][msg.sender], "MS: pas confirme");
        isConfirmed[id][msg.sender] = false;
        transactions[id].confirmations -= 1;
        emit Revoked(id, msg.sender);
    }

    function execute(uint256 id) external onlyOwner txExists(id) notExecuted(id) nonReentrant {
        Transaction storage t = transactions[id];
        // CHECKS
        require(t.confirmations >= required, "MS: pas assez de signatures");
        // EFFECTS
        t.executed = true;
        // INTERACTIONS
        (bool ok, ) = t.to.call{value: t.value}("");
        require(ok, "MS: transfert echoue");
        emit Executed(id, t.to, t.value);
    }

    function transactionCount() external view returns (uint256) {
        return transactions.length;
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }
}