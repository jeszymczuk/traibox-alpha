// Minimal event-only anchoring contract (EVM-compatible, including XDC).
// Stores no state; emits an Anchored event with the Merkle root commitment.
pragma solidity ^0.8.20;

contract AnchorRegistry {
  event Anchored(bytes32 indexed root, bytes32 indexed memo, address indexed sender, uint256 blockNumber, uint256 ts);

  function anchor(bytes32 root, bytes32 memo) external {
    emit Anchored(root, memo, msg.sender, block.number, block.timestamp);
  }
}

