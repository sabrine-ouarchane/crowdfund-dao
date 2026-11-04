'npx hardhat clean' running (wd: C:\Users\hp\Desktop\Mini_Projet_Blockchain)
'npx hardhat clean --global' running (wd: C:\Users\hp\Desktop\Mini_Projet_Blockchain)
'npx hardhat compile --force' running (wd: C:\Users\hp\Desktop\Mini_Projet_Blockchain)
**THIS CHECKLIST IS NOT COMPLETE**. Use `--show-ignored-findings` to show all the results.
Summary
 - [timestamp](#timestamp) (9 results) (Low)
 - [low-level-calls](#low-level-calls) (3 results) (Informational)
## timestamp
Impact: Low
Confidence: Medium
 - [ ] ID-0
[Crowdfunding.freezeCampaign(uint256)](contracts/Crowdfunding.sol#L144-L149) uses timestamp for comparisons
	Dangerous comparisons:
	- [require(bool,string)(c.status == Status.Active || c.status == Status.Successful,CF: statut invalide)](contracts/Crowdfunding.sol#L146)

contracts/Crowdfunding.sol#L144-L149


 - [ ] ID-1
[Crowdfunding.contribute(uint256)](contracts/Crowdfunding.sol#L93-L105) uses timestamp for comparisons
	Dangerous comparisons:
	- [require(bool,string)(c.status == Status.Active,CF: campagne non active)](contracts/Crowdfunding.sol#L95)
	- [require(bool,string)(block.timestamp < c.deadline,CF: campagne terminee)](contracts/Crowdfunding.sol#L96)

contracts/Crowdfunding.sol#L93-L105


 - [ ] ID-2
[Crowdfunding.refund(uint256)](contracts/Crowdfunding.sol#L115-L133) uses timestamp for comparisons
	Dangerous comparisons:
	- [require(bool,string)(c.status == Status.Failed || c.status == Status.Cancelled,CF: remboursement impossible)](contracts/Crowdfunding.sol#L118)

contracts/Crowdfunding.sol#L115-L133


 - [ ] ID-3
[Crowdfunding.withdrawFunds(uint256,uint256)](contracts/Crowdfunding.sol#L151-L171) uses timestamp for comparisons
	Dangerous comparisons:
	- [require(bool,string)(msg.sender == c.beneficiary,CF: seul le beneficiaire)](contracts/Crowdfunding.sol#L154)
	- [require(bool,string)(c.status == Status.Active || c.status == Status.Successful,CF: statut invalide)](contracts/Crowdfunding.sol#L155)
	- [require(bool,string)(amount > 0 && amount <= c.approved - c.withdrawn,CF: montant non autorise)](contracts/Crowdfunding.sol#L156)

contracts/Crowdfunding.sol#L151-L171


 - [ ] ID-4
[Governance.getProposal(uint256)](contracts/Governance.sol#L153-L156) uses timestamp for comparisons
	Dangerous comparisons:
	- [require(bool,string)(id < proposals.length,GOV: proposition inexistante)](contracts/Governance.sol#L154)

contracts/Governance.sol#L153-L156


 - [ ] ID-5
[Governance.state(uint256)](contracts/Governance.sol#L117-L132) uses timestamp for comparisons
	Dangerous comparisons:
	- [require(bool,string)(id < proposals.length,GOV: proposition inexistante)](contracts/Governance.sol#L118)
	- [block.timestamp < p.voteEnd](contracts/Governance.sol#L122)
	- [block.timestamp < eta](contracts/Governance.sol#L129)
	- [block.timestamp <= eta + GRACE_PERIOD](contracts/Governance.sol#L130)

contracts/Governance.sol#L117-L132


 - [ ] ID-6
[Crowdfunding.approveRelease(uint256,uint256)](contracts/Crowdfunding.sol#L134-L142) uses timestamp for comparisons
	Dangerous comparisons:
	- [require(bool,string)(c.status == Status.Active || c.status == Status.Successful,CF: statut invalide)](contracts/Crowdfunding.sol#L136)
	- [require(bool,string)(c.approved + amount <= c.raised,CF: depasse les fonds collectes)](contracts/Crowdfunding.sol#L138)

contracts/Crowdfunding.sol#L134-L142


 - [ ] ID-7
[Crowdfunding.finalize(uint256)](contracts/Crowdfunding.sol#L106-L113) uses timestamp for comparisons
	Dangerous comparisons:
	- [require(bool,string)(c.status == Status.Active,CF: deja finalisee)](contracts/Crowdfunding.sol#L108)
	- [require(bool,string)(block.timestamp >= c.deadline,CF: pas encore terminee)](contracts/Crowdfunding.sol#L109)

contracts/Crowdfunding.sol#L106-L113


 - [ ] ID-8
[Governance.vote(uint256,bool)](contracts/Governance.sol#L99-L116) uses timestamp for comparisons
	Dangerous comparisons:
	- [require(bool,string)(id < proposals.length,GOV: proposition inexistante)](contracts/Governance.sol#L100)
	- [require(bool,string)(block.timestamp < p.voteEnd,GOV: vote termine)](contracts/Governance.sol#L102)

contracts/Governance.sol#L99-L116


## low-level-calls
Impact: Informational
Confidence: High
 - [ ] ID-9
Low level call in [MultiSigTreasury.execute(uint256)](contracts/MultiSigTreasury.sol#L98-L108):
	- [(ok,None) = t.to.call{value: t.value}()](contracts/MultiSigTreasury.sol#L105)

contracts/MultiSigTreasury.sol#L98-L108


 - [ ] ID-10
Low level call in [Crowdfunding.withdrawFunds(uint256,uint256)](contracts/Crowdfunding.sol#L151-L171):
	- [(ok,None) = address(c.beneficiary).call{value: amount}()](contracts/Crowdfunding.sol#L167)

contracts/Crowdfunding.sol#L151-L171


 - [ ] ID-11
Low level call in [Crowdfunding.refund(uint256)](contracts/Crowdfunding.sol#L115-L133):
	- [(ok,None) = address(msg.sender).call{value: amount}()](contracts/Crowdfunding.sol#L130)

contracts/Crowdfunding.sol#L115-L133


