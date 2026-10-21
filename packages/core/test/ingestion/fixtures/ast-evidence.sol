pragma solidity ^0.8.20;

contract AstEvidence {
  uint256 public balance;
  address private owner;

  modifier onlyOwner() {
    require(msg.sender == owner);
    _;
  }

  function trigger() external {
    this.withdraw();
  }

  function withdraw() external onlyOwner {
    _debit();
  }

  function _debit() internal {
    balance = balance - 1;
  }
}
