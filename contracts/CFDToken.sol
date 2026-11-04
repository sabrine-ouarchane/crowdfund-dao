// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
/**
 * @title  CFDToken - jeton de gouvernance de la plateforme
 * @notice 1 ETH contribue = 1 000 CFD. Les CFD servent de droit de vote.
 */
contract CFDToken is ERC20, ERC20Votes, AccessControl {

    /// Badge reserve au contrat Crowdfunding
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(address admin)
        ERC20("CrowdFund DAO Token", "CFD")
        EIP712("CrowdFund DAO Token", "1")
    {
        require(admin != address(0), "CFD: admin = adresse nulle");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }
        /// Cree des CFD pour un contributeur (appele par Crowdfunding.contribute)
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (delegates(to) == address(0)) {
            _delegate(to, to);
        }
        _mint(to, amount);
    }

    /// Detruit des CFD (appele par Crowdfunding.refund)
    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(from, amount);
    }

    /// Surcharge obligatoire : ERC20 et ERC20Votes definissent tous deux _update
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }
}