// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Crowdfunding} from "../Crowdfunding.sol";

/**
 * @notice Contrat MALVEILLANT utilise uniquement dans les tests.
 *         Il tente de vider Crowdfunding en rappelant refund() pendant qu'il recoit l'ETH.
 */
contract ReentrancyAttacker {
    Crowdfunding public immutable target;
    uint256 public campaignId;
    uint256 public reentryAttempts;

    constructor(Crowdfunding _target) {
        target = _target;
    }

    // 1. L'attaquant contribue normalement
    function contributeTo(uint256 id) external payable {
        campaignId = id;
        target.contribute{value: msg.value}(id);
    }

    // 2. Il demande son remboursement...
    function attack() external {
        target.refund(campaignId);
    }

    // 3. ... et quand Crowdfunding lui envoie l'ETH, cette fonction s'execute
    //    automatiquement : il rappelle refund() AVANT que le premier appel soit fini
    receive() external payable {
        if (reentryAttempts < 5) {
            reentryAttempts++;
            target.refund(campaignId);
        }
    }
}