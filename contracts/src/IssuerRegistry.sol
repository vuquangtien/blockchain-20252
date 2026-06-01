// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IIssuerRegistry} from "./IIssuerRegistry.sol";

/// @title IssuerRegistry
/// @notice On-chain registry of authorized credential issuers (universities).
/// @dev    The registry is administered by an owner (e.g. the Ministry of Education or a DAO).
///         Each registered issuer is identified by an Ethereum address whose secp256k1 private
///         key is also used to sign credentials off-chain. This unifies the on-chain identity
///         and the ECC signing key so verifiers can resolve "who signed this credential" to a
///         single, governance-approved record.
contract IssuerRegistry is IIssuerRegistry, Ownable2Step {
    mapping(address => Issuer) private _issuers;
    address[] private _issuerList;
    mapping(address => uint256) private _issuerIndex; // 1-based, 0 means not present

    error IssuerAlreadyRegistered(address issuer);
    error IssuerNotRegistered(address issuer);
    error IssuerAlreadyActive(address issuer);
    error IssuerAlreadyRevoked(address issuer);
    error EmptyName();

    constructor(address admin) Ownable(admin) {}

    /// @inheritdoc IIssuerRegistry
    function registerIssuer(address issuer, string calldata name, string calldata metadataURI)
        external
        override
        onlyOwner
    {
        if (issuer == address(0)) revert IssuerNotRegistered(issuer);
        if (bytes(name).length == 0) revert EmptyName();
        if (_issuerIndex[issuer] != 0) revert IssuerAlreadyRegistered(issuer);

        _issuers[issuer] = Issuer({
            name: name,
            metadataURI: metadataURI,
            registeredAt: uint64(block.timestamp),
            revokedAt: 0,
            active: true
        });
        _issuerList.push(issuer);
        _issuerIndex[issuer] = _issuerList.length;

        emit IssuerRegistered(issuer, name, metadataURI);
    }

    /// @inheritdoc IIssuerRegistry
    function updateIssuer(address issuer, string calldata name, string calldata metadataURI)
        external
        override
        onlyOwner
    {
        if (_issuerIndex[issuer] == 0) revert IssuerNotRegistered(issuer);
        if (bytes(name).length == 0) revert EmptyName();

        Issuer storage rec = _issuers[issuer];
        rec.name = name;
        rec.metadataURI = metadataURI;

        emit IssuerUpdated(issuer, name, metadataURI);
    }

    /// @inheritdoc IIssuerRegistry
    function revokeIssuer(address issuer, string calldata reason) external override onlyOwner {
        if (_issuerIndex[issuer] == 0) revert IssuerNotRegistered(issuer);
        Issuer storage rec = _issuers[issuer];
        if (!rec.active) revert IssuerAlreadyRevoked(issuer);
        rec.active = false;
        rec.revokedAt = uint64(block.timestamp);
        emit IssuerRevoked(issuer, reason);
    }

    /// @inheritdoc IIssuerRegistry
    function reinstateIssuer(address issuer) external override onlyOwner {
        if (_issuerIndex[issuer] == 0) revert IssuerNotRegistered(issuer);
        Issuer storage rec = _issuers[issuer];
        if (rec.active) revert IssuerAlreadyActive(issuer);
        rec.active = true;
        rec.revokedAt = 0;
        emit IssuerReinstated(issuer);
    }

    /// @inheritdoc IIssuerRegistry
    function isAuthorized(address issuer) external view override returns (bool) {
        return _issuers[issuer].active;
    }

    /// @inheritdoc IIssuerRegistry
    function getIssuer(address issuer) external view override returns (Issuer memory) {
        if (_issuerIndex[issuer] == 0) revert IssuerNotRegistered(issuer);
        return _issuers[issuer];
    }

    function issuerCount() external view returns (uint256) {
        return _issuerList.length;
    }

    function issuerAt(uint256 idx) external view returns (address) {
        return _issuerList[idx];
    }
}
