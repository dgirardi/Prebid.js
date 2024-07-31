/**
 * @id prebid/hardware-concurrency
 * @name hardwareConcurrency
 * @kind problem
 * @problem.severity warning
 * @description Finds uses of hardwareConcurrency
 */

import javascript

from DataFlow::SourceNode nav
where
  nav = DataFlow::globalVarRef("navigator") or
  nav = DataFlow::globalVarRef("top").getAPropertyRead("navigator")
select nav.getAPropertyRead("hardwareConcurrency"), "hardwareConcurrency is an indicator of fingerprinting"
