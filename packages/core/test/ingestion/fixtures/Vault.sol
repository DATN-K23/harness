// Sanitized test fixture; no ground-truth or adjudication metadata.
pragma solidity ^0.8.20;

contract Vault {
    mapping(address => uint256) public balances;

    function withdraw() external {
        // Deliberately simple fixture for source mapping only.
        balances[msg.sender] = 0;
    }
}
