#pragma once

#include <react/renderer/components/CzMarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/CzMarkdownTextSpec/Props.h>
#include <react/renderer/components/CzMarkdownTextSpec/States.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

namespace facebook::react {
extern const char CzMarkdownTextRunComponentName[];

using CzMarkdownTextRunShadowNode = ConcreteViewShadowNode<
    CzMarkdownTextRunComponentName,
    CzMarkdownTextRunProps,
    CzMarkdownTextRunEventEmitter,
    CzMarkdownTextRunState>;
}
